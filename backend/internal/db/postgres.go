// Package db owns the Postgres connection and every SQL query the backend
// runs. Handlers never write SQL themselves — they call a method on Store.
// That keeps the query surface in one file, which matters more than usual
// here since this schema will likely change as real hardware data arrives.
package db

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" driver
)

//go:embed migrations/001_init.sql
var initSchema string

// Store wraps a *sql.DB. Every query method hangs off Store so handlers
// depend on an interface-shaped thing, not a raw connection.
type Store struct {
	DB *sql.DB
}

// Open connects to Postgres using the DATABASE_URL env var, applies the
// schema (safe to run every boot: every statement is CREATE ... IF NOT
// EXISTS), and returns a ready Store.
func Open(ctx context.Context) (*Store, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://cyclesafe:cyclesafe@localhost:5432/cyclesafe?sslmode=disable"
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	// Postgres inside docker-compose can take a few seconds to accept
	// connections after the container reports "started". Retry instead of
	// crash-looping the backend container on first `docker compose up`.
	var pingErr error
	for i := 0; i < 10; i++ {
		if pingErr = db.PingContext(ctx); pingErr == nil {
			break
		}
		time.Sleep(2 * time.Second)
	}
	if pingErr != nil {
		return nil, fmt.Errorf("ping postgres after retries: %w", pingErr)
	}

	if _, err := db.ExecContext(ctx, initSchema); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	return &Store{DB: db}, nil
}

func (s *Store) Close() error {
	return s.DB.Close()
}

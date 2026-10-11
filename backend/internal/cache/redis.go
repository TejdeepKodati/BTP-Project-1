package cache

import (
	"context"
	"encoding/json"
	"github.com/go-redis/redis/v8"
	"os"
	"time"
)

type Cache struct {
	client *redis.Client
}

func Connect() *Cache {
	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "localhost:6379"
	}
	return &Cache{client: redis.NewClient(&redis.Options{Addr: addr})}
}

func (c *Cache) Close() error {
	return c.client.Close()
}

// Get unmarshals a cached value into dest. It returns (false, nil) on a
// clean cache miss so callers can fall through to Postgres without
// treating "not cached yet" as an error.
func (c *Cache) Get(ctx context.Context, key string, dest any) (bool, error) {
	raw, err := c.client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		return false, err
	}
	return true, nil
}

// Set caches value under key for ttl. Errors are the caller's decision to
// ignore or not — a cache write failing should never fail the request.
func (c *Cache) Set(ctx context.Context, key string, value any, ttl time.Duration) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.client.Set(ctx, key, raw, ttl).Err()
}

func (c *Cache) InvalidatePrefix(ctx context.Context, prefix string) {
	iter := c.client.Scan(ctx, 0, prefix+"*", 0).Iterator()
	for iter.Next(ctx) {
		c.client.Del(ctx, iter.Val())
	}
}

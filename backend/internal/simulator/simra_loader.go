package simulator

import (
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strconv"
	"time"

	"cyclesafe/internal/geo"
	"cyclesafe/internal/models"
)

var simRaColumns = []string{
	"lat", "lon", "X", "Y", "Z", "timeStamp", "acc", "a", "b", "c",
	"obsDistanceLeft1", "obsDistanceLeft2", "obsDistanceRight1", "obsDistanceRight2",
	"obsClosePassEvent", "XL", "YL", "ZL", "RX", "RY", "RZ", "RC",
}

func LoadCSV(path string) ([]models.RidePoint, float64, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, fmt.Errorf("open csv: %w", err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.TrimLeadingSpace = true

	header, err := r.Read()
	if err != nil {
		return nil, 0, fmt.Errorf("read header: %w", err)
	}
	idx, err := columnIndex(header)
	if err != nil {
		return nil, 0, err
	}

	var points []models.RidePoint
	seq := 0
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, 0, fmt.Errorf("read row %d: %w", seq, err)
		}

		p, err := parseRow(row, idx, seq)
		if err != nil {
			return nil, 0, fmt.Errorf("parse row %d: %w", seq, err)
		}
		points = append(points, p)
		seq++
	}

	return points, totalDistanceMeters(points), nil
}

func columnIndex(header []string) (map[string]int, error) {
	idx := make(map[string]int, len(header))
	for i, name := range header {
		idx[name] = i
	}
	for _, want := range simRaColumns {
		if _, ok := idx[want]; !ok {
			return nil, fmt.Errorf("csv missing expected SimRa column %q", want)
		}
	}
	return idx, nil
}

func parseRow(row []string, idx map[string]int, seq int) (models.RidePoint, error) {
	get := func(col string) float64 {
		v, _ := strconv.ParseFloat(row[idx[col]], 64)
		return v
	}
	getOptional := func(col string) *float64 {
		raw := row[idx[col]]
		if raw == "" {
			return nil
		}
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return nil
		}
		return &v
	}

	tsMillis, err := strconv.ParseInt(row[idx["timeStamp"]], 10, 64)
	if err != nil {
		return models.RidePoint{}, fmt.Errorf("timeStamp: %w", err)
	}

	left := minOptional(getOptional("obsDistanceLeft1"), getOptional("obsDistanceLeft2"))
	right := minOptional(getOptional("obsDistanceRight1"), getOptional("obsDistanceRight2"))

	return models.RidePoint{
		Seq:           seq,
		Lat:           get("lat"),
		Lon:           get("lon"),
		AccelX:        get("X"),
		AccelY:        get("Y"),
		AccelZ:        get("Z"),
		GyroA:         get("a"),
		GyroB:         get("b"),
		GyroC:         get("c"),
		LinAccelX:     get("XL"),
		LinAccelY:     get("YL"),
		LinAccelZ:     get("ZL"),
		ObsDistLeftM:  left,
		ObsDistRightM: right,
		RecordedAt:    time.UnixMilli(tsMillis).UTC(),
	}, nil
}

func minOptional(a, b *float64) *float64 {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if *a < *b {
		return a
	}
	return b
}

func totalDistanceMeters(points []models.RidePoint) float64 {
	var total float64
	for i := 1; i < len(points); i++ {
		a, b := points[i-1], points[i]
		total += geo.HaversineM(a.Lat, a.Lon, b.Lat, b.Lon)
	}
	return total
}

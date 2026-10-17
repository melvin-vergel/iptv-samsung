package main

import (
	"strconv"
	"time"
)

const timeRFC3339 = time.RFC3339

func nowISO() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func itoa(n int) string { return strconv.Itoa(n) }

#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p build
go test ./...
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -buildvcs=false -trimpath -ldflags='-s -w' -o build/blackbox-arm64.bin .
CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 go build -buildvcs=false -trimpath -ldflags='-s -w' -o build/blackbox-armv7.bin .
go build -buildvcs=false -trimpath -o build/blackbox-host .

//go:build !embed

package ui

import "io/fs"

// FS is nil when the binary is not compiled with -tags embed.
// The server falls back to disk-based static file serving in this case.
var FS fs.FS

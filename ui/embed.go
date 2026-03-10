//go:build embed

package ui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embeddedFiles embed.FS

// FS is the sub-filesystem rooted at the built frontend dist directory.
// It is non-nil only when the binary is compiled with -tags embed.
var FS fs.FS

func init() {
	sub, err := fs.Sub(embeddedFiles, "dist")
	if err != nil {
		panic("ui: failed to sub embedded dist: " + err.Error())
	}
	FS = sub
}

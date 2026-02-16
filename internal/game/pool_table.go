package game

// CushionLine represents a cushion wall segment with precomputed collision surfaces.
type CushionLine struct {
	Name      string `json:"name"`
	P1        Vec2   `json:"p1"`
	P2        Vec2   `json:"p2"`
	P3        Vec2   `json:"p3"` // offset by ballRadius * normal (primary collision line)
	P4        Vec2   `json:"p4"`
	P5        Vec2   `json:"p5"` // offset by 0.8 * ballRadius * normal (fallback)
	P6        Vec2   `json:"p6"`
	Direction Vec2   `json:"direction"` // normalized direction from p1 to p2
	Normal    Vec2   `json:"normal"`    // left normal of direction
}

// Vertex represents a corner point where cushions meet.
type Vertex struct {
	Name     string `json:"name"`
	Position Vec2   `json:"position"`
}

// Pocket represents one of the 6 pockets on the table.
type Pocket struct {
	ID           int  `json:"id"`
	Position     Vec2 `json:"position"`
	DropPosition Vec2 `json:"drop_position"`
}

// Table holds the complete table geometry.
type Table struct {
	Lines    []CushionLine
	Vertices []Vertex
	Pockets  []Pocket
}

// NewStandard8BallTable creates the standard table geometry.
// All coordinates extracted from 14setup.js with n = 600 * adjustmentScale = 1380.
func NewStandard8BallTable() *Table {
	n := N // 1380
	pr := PocketRadius
	br := BallRadius

	// Pockets (6 total)
	pockets := []Pocket{
		{ID: 0, Position: NewVec2(-50*n-pr/2, -25*n-pr/4), DropPosition: NewVec2(-51*n-pr/2, -26*n-pr/4)},
		{ID: 1, Position: NewVec2(0, -25*n-pr), DropPosition: NewVec2(0, -25.5*n-pr)},
		{ID: 2, Position: NewVec2(50*n+pr/2, -25*n-pr/4), DropPosition: NewVec2(51*n+pr/2, -26*n-pr/4)},
		{ID: 3, Position: NewVec2(-50*n-pr/2, 25*n+pr/4), DropPosition: NewVec2(-51*n-pr/2, 26*n+pr/4)},
		{ID: 4, Position: NewVec2(0, 25*n+pr), DropPosition: NewVec2(0, 25.5*n+pr)},
		{ID: 5, Position: NewVec2(50*n+pr/2, 25*n+pr/4), DropPosition: NewVec2(51*n+pr/2, 26*n+pr/4)},
	}

	// Cushion lines (22 segments) from 14setup.js
	rawLines := []struct {
		name   string
		p1, p2 Vec2
	}{
		// Top-left corner to top-center
		{"AB", NewVec2(-50*n, -29*n), NewVec2(-46*n, -25*n)},
		{"BC", NewVec2(-46*n, -25*n), NewVec2(-4*n, -25*n)},
		{"CD", NewVec2(-4*n, -25*n), NewVec2(-2*n, -29*n)},
		// Top-center to top-right
		{"EF", NewVec2(2*n, -29*n), NewVec2(4*n, -25*n)},
		{"FG", NewVec2(4*n, -25*n), NewVec2(46*n, -25*n)},
		{"GH", NewVec2(46*n, -25*n), NewVec2(50*n, -29*n)},
		// Right side
		{"IJ", NewVec2(54*n, -25*n), NewVec2(50*n, -21*n)},
		{"JK", NewVec2(50*n, -21*n), NewVec2(50*n, 21*n)},
		{"KL", NewVec2(50*n, 21*n), NewVec2(54*n, 25*n)},
		// Bottom-right to bottom-center
		{"MN", NewVec2(50*n, 29*n), NewVec2(46*n, 25*n)},
		{"NO", NewVec2(46*n, 25*n), NewVec2(4*n, 25*n)},
		{"OP", NewVec2(4*n, 25*n), NewVec2(2*n, 29*n)},
		// Bottom-center to bottom-left
		{"QR", NewVec2(-2*n, 29*n), NewVec2(-4*n, 25*n)},
		{"RS", NewVec2(-4*n, 25*n), NewVec2(-46*n, 25*n)},
		{"ST", NewVec2(-46*n, 25*n), NewVec2(-50*n, 29*n)},
		// Left side
		{"UV", NewVec2(-54*n, 25*n), NewVec2(-50*n, 21*n)},
		{"VW", NewVec2(-50*n, 21*n), NewVec2(-50*n, -21*n)},
		{"WX", NewVec2(-50*n, -21*n), NewVec2(-54*n, -25*n)},
	}

	lines := make([]CushionLine, len(rawLines))
	for i, rl := range rawLines {
		dir := rl.p2.Minus(rl.p1).Normalize()
		normal := dir.LeftNormal()
		offset1 := normal.Times(br)
		offset2 := normal.Times(0.8 * br)

		lines[i] = CushionLine{
			Name:      rl.name,
			P1:        rl.p1,
			P2:        rl.p2,
			Direction: dir,
			Normal:    normal,
			P3:        rl.p1.Plus(offset1),
			P4:        rl.p2.Plus(offset1),
			P5:        rl.p1.Plus(offset2),
			P6:        rl.p2.Plus(offset2),
		}
	}

	// Vertices (12 corner points) — p2 of angled lines leading into straight runs
	vertices := []Vertex{
		{Name: "B", Position: NewVec2(-46*n, -25*n)},
		{Name: "C", Position: NewVec2(-4*n, -25*n)},
		{Name: "F", Position: NewVec2(4*n, -25*n)},
		{Name: "G", Position: NewVec2(46*n, -25*n)},
		{Name: "J", Position: NewVec2(50*n, -21*n)},
		{Name: "K", Position: NewVec2(50*n, 21*n)},
		{Name: "N", Position: NewVec2(46*n, 25*n)},
		{Name: "O", Position: NewVec2(4*n, 25*n)},
		{Name: "R", Position: NewVec2(-4*n, 25*n)},
		{Name: "S", Position: NewVec2(-46*n, 25*n)},
		{Name: "V", Position: NewVec2(-50*n, 21*n)},
		{Name: "W", Position: NewVec2(-50*n, -21*n)},
	}

	return &Table{
		Lines:    lines,
		Vertices: vertices,
		Pockets:  pockets,
	}
}

// Standard8BallRack returns the initial positions for all 16 balls (case 15 from levelData).
// Uses fixed offsets (no random jitter) for deterministic online play.
func Standard8BallRack() [NumBalls]Vec2 {
	var pos [NumBalls]Vec2

	i := 15000 * AdjustmentScale // 34500
	e := 1.782                   // 1.732 + 0.05 (fixed, no random)
	s := 1.05                    // 1.0 + 0.05 (fixed, no random)
	br := BallRadius

	// Cue ball (far left)
	pos[0] = NewVec2(-i, 0)

	// Apex ball
	pos[1] = NewVec2(i, 0)

	// Row 2
	pos[2] = NewVec2(i+e*br, br*s)
	pos[15] = NewVec2(i+e*br, -br*s)

	// Row 3 (8-ball in center)
	pos[8] = NewVec2(i+2*e*br, 0)
	pos[5] = NewVec2(i+2*e*br, 2*br*s)
	pos[10] = NewVec2(i+2*e*br, -2*br*s)

	// Row 4
	pos[7] = NewVec2(i+3*e*br, 1*br*s)
	pos[4] = NewVec2(i+3*e*br, 3*br*s)
	pos[9] = NewVec2(i+3*e*br, -1*br*s)
	pos[6] = NewVec2(i+3*e*br, -3*br*s)

	// Row 5
	pos[11] = NewVec2(i+4*e*br, 0)
	pos[12] = NewVec2(i+4*e*br, 2*br*s)
	pos[13] = NewVec2(i+4*e*br, -2*br*s)
	pos[14] = NewVec2(i+4*e*br, 4*br*s)
	pos[3] = NewVec2(i+4*e*br, -4*br*s)

	return pos
}

package game

import "math"

// point is an internal helper for collision math (matches JS Point).
type point struct {
	x, y float64
}

// intersectResult holds the result of a line-circle intersection test.
type intersectResult struct {
	inside     bool
	tangent    bool
	intersects bool
	enter      *point
	exit       *point
}

// lineIntersectCircle tests if a line segment (p1→p2) intersects a circle.
// Ported from Maths.lineIntersectCircle in 06maths.js.
func lineIntersectCircle(p1, p2, center point, radius float64) intersectResult {
	r := intersectResult{}

	dx := p2.x - p1.x
	dy := p2.y - p1.y
	fx := p1.x - center.x
	fy := p1.y - center.y

	a := fix(dx*dx + dy*dy)
	b := fix(2 * (dx*fx + dy*fy))
	c := fix(center.x*center.x + center.y*center.y + p1.x*p1.x + p1.y*p1.y - 2*(center.x*p1.x+center.y*p1.y) - radius*radius)

	discriminant := fix(b*b - 4*a*c)

	if discriminant <= 0 {
		return r
	}

	sqrtDisc := fix(math.Sqrt(discriminant))
	t1 := fix((-b + sqrtDisc) / (2 * a)) // exit
	t2 := fix((-b - sqrtDisc) / (2 * a)) // enter

	// Both outside segment
	if (t1 < 0 || t1 > 1) && (t2 < 0 || t2 > 1) {
		// Check if line is fully inside circle
		if t1 < 0 && t2 < 0 || t1 > 1 && t2 > 1 {
			r.inside = false
		} else {
			r.inside = true
		}
		return r
	}

	// Enter point
	if t2 >= 0 && t2 <= 1 {
		enterPt := pointInterpolate(p1, p2, t2)
		enterFixed := point{fix(enterPt.x), fix(enterPt.y)}
		r.enter = &enterFixed
	}

	// Exit point
	if t1 >= 0 && t1 <= 1 {
		exitPt := pointInterpolate(p1, p2, t1)
		exitFixed := point{fix(exitPt.x), fix(exitPt.y)}
		r.exit = &exitFixed
	}

	r.intersects = true

	// Tangent check
	if r.exit != nil && r.enter != nil && r.exit.x == r.enter.x && r.exit.y == r.enter.y {
		r.tangent = true
	}

	return r
}

// lineIntersectLine tests if two line segments intersect.
// Ported from Maths.lineIntersectLine in 06maths.js.
func lineIntersectLine(p1, p2, p3, p4 point) *point {
	a1 := p2.y - p1.y
	b1 := p1.x - p2.x
	c1 := p2.x*p1.y - p1.x*p2.y

	a2 := p4.y - p3.y
	b2 := p3.x - p4.x
	c2 := p4.x*p3.y - p3.x*p4.y

	denom := a1*b2 - a2*b1
	if denom == 0 {
		return nil // parallel
	}

	x := fix((b1*c2 - b2*c1) / denom)
	y := fix((a2*c1 - a1*c2) / denom)

	// Check if intersection is within both segments
	if (x-p1.x)*(x-p2.x) > 0 || (y-p1.y)*(y-p2.y) > 0 ||
		(x-p3.x)*(x-p4.x) > 0 || (y-p3.y)*(y-p4.y) > 0 {
		return nil
	}

	return &point{x, y}
}

// checkObjectsConverging returns true if two objects are moving toward each other.
// Ported from Maths.checkObjectsConverging in 06maths.js.
func checkObjectsConverging(posA, posB Vec2, velA, velB Vec2) bool {
	relVel := velB.Minus(velA)
	direction := posB.Minus(posA).Normalize()
	return relVel.AngleBetween(direction) > 90
}

// createVectorFrom2Points creates a Vec2 from point a to point b.
func createVectorFrom2Points(a, b point) Vec2 {
	return NewVec2(b.x-a.x, b.y-a.y)
}

// pointInterpolate linearly interpolates between two points.
func pointInterpolate(a, b point, t float64) point {
	return point{
		x: fix((1-t)*a.x + t*b.x),
		y: fix((1-t)*a.y + t*b.y),
	}
}

// findBearing returns the angle in degrees from dx, dy.
func findBearing(dx, dy float64) float64 {
	return fix(math.Atan2(dy, dx) * 180 / math.Pi)
}

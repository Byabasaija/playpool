package game

import "math"

// Vec2 is a 2D vector with fixed-precision arithmetic to match client-side physics.
type Vec2 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// fix rounds to 4 decimal places, matching Maths.fixNumber in the JS reference.
func fix(n float64) float64 {
	if math.IsNaN(n) {
		return 0
	}
	return math.Round(n*10000) / 10000
}

func NewVec2(x, y float64) Vec2 {
	return Vec2{X: fix(x), Y: fix(y)}
}

func (v Vec2) Plus(o Vec2) Vec2 {
	return Vec2{X: fix(v.X + o.X), Y: fix(v.Y + o.Y)}
}

func (v Vec2) Minus(o Vec2) Vec2 {
	return Vec2{X: fix(v.X - o.X), Y: fix(v.Y - o.Y)}
}

func (v Vec2) Times(s float64) Vec2 {
	return Vec2{X: fix(v.X * s), Y: fix(v.Y * s)}
}

func (v Vec2) TimesVec(o Vec2) Vec2 {
	return Vec2{X: fix(v.X * o.X), Y: fix(v.Y * o.Y)}
}

func (v Vec2) Dot(o Vec2) float64 {
	return fix(v.X*o.X + v.Y*o.Y)
}

func (v Vec2) Cross(o Vec2) float64 {
	return math.Abs(fix(v.X*o.Y - v.Y*o.X))
}

func (v Vec2) Magnitude() float64 {
	return fix(math.Sqrt(v.X*v.X + v.Y*v.Y))
}

func (v Vec2) MagnitudeSquared() float64 {
	return fix(v.X*v.X + v.Y*v.Y)
}

func (v Vec2) Normalize() Vec2 {
	m := v.Magnitude()
	if m == 0 {
		return Vec2{}
	}
	return v.Times(1.0 / m)
}

func (v Vec2) RightNormal() Vec2 {
	return Vec2{X: v.Y, Y: -v.X}
}

func (v Vec2) LeftNormal() Vec2 {
	return Vec2{X: -v.Y, Y: v.X}
}

func (v Vec2) Rotate(degrees float64) Vec2 {
	rad := degrees * math.Pi / 180
	mag := math.Sqrt(v.X*v.X + v.Y*v.Y)
	currentAngle := math.Atan2(v.Y, v.X)
	newAngle := currentAngle + rad
	return Vec2{
		X: fix(mag * math.Cos(newAngle)),
		Y: fix(mag * math.Sin(newAngle)),
	}
}

func (v Vec2) Invert() Vec2 {
	return Vec2{X: -v.X, Y: -v.Y}
}

func (v Vec2) AngleBetween(o Vec2) float64 {
	denom := v.Magnitude() * o.Magnitude()
	if denom == 0 {
		return 0
	}
	cos := v.Dot(o) / denom
	// Clamp to [-1, 1] to avoid NaN from acos
	if cos > 1 {
		cos = 1
	}
	if cos < -1 {
		cos = -1
	}
	return fix(math.Acos(cos) * 180 / math.Pi)
}

func (v Vec2) AngleBetweenCos(o Vec2) float64 {
	denom := v.Magnitude() * o.Magnitude()
	if denom == 0 {
		return 0
	}
	return fix(v.Dot(o) / denom)
}

func (v Vec2) IsZero() bool {
	return v.X == 0 && v.Y == 0
}

func (v Vec2) IsEqualTo(o Vec2) bool {
	return v.X == o.X && v.Y == o.Y
}

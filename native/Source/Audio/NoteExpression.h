#pragma once
#include <array>

namespace musegrid
{
    // Per-note expression transfer object. Curves are normalised 0..1 LUTs built by the
    // frontend from the same shape maths used for the canvas preview, so native playback
    // reproduces arbitrary (including custom-equation) glide and filter shapes.
    struct NoteExpression
    {
        static constexpr int kCurvePoints = 33;

        std::array<float, kCurvePoints> slideCurve {};
        int slideCurveSize = 0;
        bool steppedGlide = false;

        float vibratoDelaySeconds = 0.0f;
        float vibratoFadeSeconds = 0.0f;
        int vibratoWave = 0; // 0 sine, 1 triangle, 2 square

        std::array<float, kCurvePoints> filterCurve {};
        int filterCurveSize = 0;

        int tremoloWave = 0; // 0 sine, 1 triangle, 2 square
    };
}

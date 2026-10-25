#pragma once
#include <juce_core/juce_core.h>
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

        // Per-note sound override: "preset" | "kit" | "vst3"; value is the preset, kit
        // name or VST3 plugin identifier. Empty kind keeps the track instrument.
        juce::String overrideKind;
        juce::String overrideValue;

        // 0 = the track FX rack applies. Non-zero renders this voice through its own
        // registered per-note chain instead, so track FX are bypassed for this note.
        int fxChainId = 0;
    };
}

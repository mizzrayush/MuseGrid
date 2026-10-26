#pragma once
#include <juce_core/juce_core.h>
#include <array>
#include <cmath>

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

        // Per-note VST3 override identity (the note id). Each key owns its own plugin
        // instance, so edits to one note's plugin state never touch another note.
        juce::String instanceKey;

        // 0 = the track FX rack applies. Non-zero renders this voice through its own
        // registered per-note chain instead, so track FX are bypassed for this note.
        int fxChainId = 0;

        // Morph glide: both instruments sound; this voice fades in/out across the junction.
        float morphFadeInSeconds = 0.0f;
        float morphFadeOutSeconds = 0.0f;

        // Per-note pan trim (-1..1, added to the track pan) and volume automation gain (0..1).
        float pan = 0.0f;
        float gain = 1.0f;
    };

    /**
     * Normalised LUT sampler shared by every voice: linear interpolation inside a curve the
     * frontend baked from the same shape maths the canvas preview draws. Fewer than two points
     * means the lane or ramp was flat, so the plain ramp position is returned.
     */
    inline float sampleCurveLut(const std::array<float, NoteExpression::kCurvePoints>& curve,
                                int count, float t)
    {
        if (count < 2) return juce::jlimit(0.0f, 1.0f, t);

        const int points = juce::jmin(count, NoteExpression::kCurvePoints);
        const float pos = juce::jlimit(0.0f, 1.0f, t) * (float)(points - 1);
        const int i0 = (int)pos;
        const int i1 = juce::jmin(i0 + 1, points - 1);
        const float frac = pos - (float)i0;
        const float value = curve[(size_t)i0] + (curve[(size_t)i1] - curve[(size_t)i0]) * frac;
        return juce::jlimit(0.0f, 1.0f, value);
    }

    /** LFO shape for the wave ids the frontend sends: 0 sine, 1 triangle, 2 square. */
    inline float lfoWaveform(int wave, double phase)
    {
        switch (wave)
        {
            case 1:  return (float)(2.0 / juce::MathConstants<double>::pi * std::asin(std::sin(phase)));
            case 2:  return std::sin(phase) >= 0.0 ? 1.0f : -1.0f;
            default: return (float)std::sin(phase);
        }
    }
}

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
}

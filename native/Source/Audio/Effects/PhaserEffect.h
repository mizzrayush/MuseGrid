#pragma once
#include <juce_audio_basics/juce_audio_basics.h>
#include <cmath>

/**
 * Stereo all-pass phaser with an octave-based sweep. The browser card exposes rate,
 * base frequency and octaves; JUCE's dsp::Phaser has no octave control, so this keeps
 * the same parameter contract as Tone.Phaser (sweep spans ±octaves/2 around base).
 */
class PhaserEffect
{
public:
    PhaserEffect() = default;

    void prepare(double sampleRate, int /*blockSize*/)
    {
        currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
        reset();
    }

    void reset()
    {
        lfoPhase = 0.0;
        for (int ch = 0; ch < 2; ++ch)
        {
            lastOut[ch] = 0.0f;
            for (int s = 0; s < kStages; ++s)
            {
                x1[ch][s] = 0.0f;
                y1[ch][s] = 0.0f;
            }
        }
    }

    void setWet(float w)
    {
        wet = juce::jlimit(0.0f, 1.0f, w);
    }

    void setRate(float r)
    {
        rate = juce::jlimit(0.01f, 40.0f, r);
    }

    void setBaseFrequency(float f)
    {
        baseFreq = juce::jlimit(20.0f, 8000.0f, f);
    }

    void setOctaves(float o)
    {
        octaves = juce::jlimit(0.1f, 8.0f, o);
    }

    void setFeedback(float f)
    {
        feedback = juce::jlimit(0.0f, 0.95f, f);
    }

    void process(juce::AudioBuffer<float>& buffer)
    {
        if (wet <= 0.001f) return;

        const int numChannels = juce::jmin(2, buffer.getNumChannels());
        const int numSamples = buffer.getNumSamples();
        const double phaseInc = (double)rate / currentSampleRate;
        const float dry = 1.0f - wet;

        float* channels[2] = { buffer.getWritePointer(0),
                               numChannels > 1 ? buffer.getWritePointer(1) : nullptr };

        for (int i = 0; i < numSamples; ++i)
        {
            const float lfo = std::sin((float)(lfoPhase * juce::MathConstants<double>::twoPi));
            const float sweepSemis = octaves * 12.0f * 0.5f * lfo;
            const float cutoff = juce::jlimit(20.0f, (float)(currentSampleRate * 0.45),
                                              baseFreq * std::pow(2.0f, sweepSemis / 12.0f));
            const float t = std::tan((float)juce::MathConstants<double>::pi * cutoff / (float)currentSampleRate);
            const float coeff = (t - 1.0f) / (t + 1.0f);

            for (int ch = 0; ch < 2; ++ch)
            {
                if (channels[ch] == nullptr) continue;
                float x = channels[ch][i] + feedback * lastOut[ch];
                float y = x;
                for (int s = 0; s < kStages; ++s)
                {
                    const float out = coeff * y + x1[ch][s] - coeff * y1[ch][s];
                    x1[ch][s] = y;
                    y1[ch][s] = out;
                    y = out;
                }
                lastOut[ch] = juce::jlimit(-4.0f, 4.0f, y);
                channels[ch][i] = channels[ch][i] * dry + y * wet;
            }

            lfoPhase += phaseInc;
            if (lfoPhase >= 1.0) lfoPhase -= 1.0;
        }
    }

private:
    static constexpr int kStages = 4;
    double currentSampleRate = 44100.0;
    double lfoPhase = 0.0;
    float wet = 0.0f;
    float rate = 0.5f;
    float baseFreq = 350.0f;
    float octaves = 3.0f;
    float feedback = 0.4f;
    float lastOut[2] = { 0.0f, 0.0f };
    float x1[2][kStages] = {};
    float y1[2][kStages] = {};
};

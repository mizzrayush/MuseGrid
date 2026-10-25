#pragma once
#include <juce_core/juce_core.h>
#include <array>
#include <cmath>
#include <algorithm>

struct EnvelopeCurve
{
    static constexpr int LUT_SIZE = 256;
    std::array<float, LUT_SIZE> table;

    EnvelopeCurve()
    {
        setExponential(-4.0f); // Default to natural acoustic exponential decay!
    }

    void setLinear()
    {
        for (int i = 0; i < LUT_SIZE; ++i)
            table[i] = 1.0f - (float)i / (float)(LUT_SIZE - 1);
    }

    void setExponential(float k = -4.0f)
    {
        // f(x) = (exp(k * x) - exp(k)) / (1.0 - exp(k))
        float expK = std::exp(k);
        float denom = 1.0f - expK;
        if (std::abs(denom) < 0.0001f) { setLinear(); return; }
        for (int i = 0; i < LUT_SIZE; ++i)
        {
            float x = (float)i / (float)(LUT_SIZE - 1);
            table[i] = juce::jlimit(0.0f, 1.0f, (std::exp(k * x) - expK) / denom);
        }
    }

    void setLogarithmic()
    {
        for (int i = 0; i < LUT_SIZE; ++i)
        {
            float x = (float)i / (float)(LUT_SIZE - 1);
            table[i] = juce::jlimit(0.0f, 1.0f, 1.0f - std::sqrt(x));
        }
    }

    void setSCurve()
    {
        for (int i = 0; i < LUT_SIZE; ++i)
        {
            float x = (float)i / (float)(LUT_SIZE - 1);
            table[i] = juce::jlimit(0.0f, 1.0f, 0.5f * (1.0f + std::cos(juce::MathConstants<float>::pi * x)));
        }
    }

    void setTension(float tension)
    {
        // tension in [-1.0, 1.0]
        if (std::abs(tension) < 0.01f) { setLinear(); return; }
        float k = tension * -8.0f;
        setExponential(k);
    }

    void setCustomLut(const float* data, int count)
    {
        if (count <= 0 || !data) return;
        for (int i = 0; i < LUT_SIZE; ++i)
        {
            float srcIdx = ((float)i / (float)(LUT_SIZE - 1)) * (float)(count - 1);
            int idx0 = (int)srcIdx;
            int idx1 = std::min(idx0 + 1, count - 1);
            float frac = srcIdx - (float)idx0;
            table[i] = juce::jlimit(0.0f, 1.0f, data[idx0] * (1.0f - frac) + data[idx1] * frac);
        }
    }

    inline float sample(float progress) const
    {
        float p = juce::jlimit(0.0f, 1.0f, progress) * (float)(LUT_SIZE - 1);
        int idx0 = (int)p;
        int idx1 = std::min(idx0 + 1, LUT_SIZE - 1);
        float frac = p - (float)idx0;
        return table[idx0] * (1.0f - frac) + table[idx1] * frac;
    }
};

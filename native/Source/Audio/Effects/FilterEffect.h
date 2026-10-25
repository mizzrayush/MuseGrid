#pragma once
#include <juce_dsp/juce_dsp.h>

class FilterEffect
{
public:
    enum class Type { LowPass, HighPass, BandPass, Notch };

    void prepare(double sampleRate, int samplesPerBlock)
    {
        currentSampleRate = sampleRate;
        juce::dsp::ProcessSpec spec;
        spec.sampleRate = sampleRate;
        spec.maximumBlockSize = (juce::uint32)samplesPerBlock;
        spec.numChannels = 2;

        filter.prepare(spec);
        filter.reset();
        updateParameters();
    }

    void reset()
    {
        filter.reset();
    }

    void setType(Type newType)
    {
        filterType = newType;
        updateParameters();
    }

    void setCutoff(float freqHz)
    {
        cutoff = juce::jlimit(20.0f, (float)(currentSampleRate * 0.49), freqHz);
        updateParameters();
    }

    void setResonance(float res)
    {
        resonance = juce::jlimit(0.1f, 18.0f, res);
        updateParameters();
    }

    void process(juce::dsp::AudioBlock<float>& block)
    {
        if (!enabled) return;
        juce::dsp::ProcessContextReplacing<float> context(block);
        filter.process(context);
    }

    void setEnabled(bool isEnabled) { enabled = isEnabled; }
    bool isEnabled() const { return enabled; }

private:
    void updateParameters()
    {
        switch (filterType)
        {
            case Type::LowPass:  filter.setType(juce::dsp::StateVariableTPTFilterType::lowpass);  break;
            case Type::HighPass: filter.setType(juce::dsp::StateVariableTPTFilterType::highpass); break;
            case Type::BandPass: filter.setType(juce::dsp::StateVariableTPTFilterType::bandpass); break;
            default:             filter.setType(juce::dsp::StateVariableTPTFilterType::lowpass);  break;
        }
        filter.setCutoffFrequency(cutoff);
        filter.setResonance(resonance);
    }

    double currentSampleRate = 44100.0;
    Type filterType = Type::LowPass;
    float cutoff = 20000.0f;
    float resonance = 0.7071f;
    bool enabled = true;

    juce::dsp::StateVariableTPTFilter<float> filter;
};

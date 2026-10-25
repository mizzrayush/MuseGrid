#pragma once
#include <juce_dsp/juce_dsp.h>

class EQEffect
{
public:
    EQEffect() = default;

    void prepare(double sampleRate, int blockSize)
    {
        currentSampleRate = sampleRate;
        juce::dsp::ProcessSpec spec;
        spec.sampleRate = sampleRate;
        spec.maximumBlockSize = (juce::uint32)blockSize;
        spec.numChannels = 2;

        lowShelf.prepare(spec);
        midPeak.prepare(spec);
        highShelf.prepare(spec);

        updateFilters();
    }

    void reset()
    {
        lowShelf.reset();
        midPeak.reset();
        highShelf.reset();
    }

    void setLowGainDb(float gainDb)
    {
        lowGain = juce::jlimit(-40.0f, 40.0f, gainDb);
        updateLow();
    }

    void setMidGainDb(float gainDb)
    {
        midGain = juce::jlimit(-40.0f, 40.0f, gainDb);
        updateMid();
    }

    void setHighGainDb(float gainDb)
    {
        highGain = juce::jlimit(-40.0f, 40.0f, gainDb);
        updateHigh();
    }

    void process(juce::AudioBuffer<float>& buffer)
    {
        // Bypass check if all gains are near 0 dB
        if (std::abs(lowGain) < 0.05f && std::abs(midGain) < 0.05f && std::abs(highGain) < 0.05f)
            return;

        juce::dsp::AudioBlock<float> block(buffer);
        juce::dsp::ProcessContextReplacing<float> context(block);

        lowShelf.process(context);
        midPeak.process(context);
        highShelf.process(context);
    }

private:
    void updateFilters()
    {
        updateLow();
        updateMid();
        updateHigh();
    }

    void updateLow()
    {
        *lowShelf.state = *juce::dsp::IIR::Coefficients<float>::makeLowShelf(
            currentSampleRate, 250.0f, 0.707f, juce::Decibels::decibelsToGain(lowGain));
    }

    void updateMid()
    {
        *midPeak.state = *juce::dsp::IIR::Coefficients<float>::makePeakFilter(
            currentSampleRate, 1000.0f, 1.0f, juce::Decibels::decibelsToGain(midGain));
    }

    void updateHigh()
    {
        *highShelf.state = *juce::dsp::IIR::Coefficients<float>::makeHighShelf(
            currentSampleRate, 4000.0f, 0.707f, juce::Decibels::decibelsToGain(highGain));
    }

    double currentSampleRate = 44100.0;
    float lowGain = 0.0f;
    float midGain = 0.0f;
    float highGain = 0.0f;

    juce::dsp::ProcessorDuplicator<juce::dsp::IIR::Filter<float>, juce::dsp::IIR::Coefficients<float>> lowShelf;
    juce::dsp::ProcessorDuplicator<juce::dsp::IIR::Filter<float>, juce::dsp::IIR::Coefficients<float>> midPeak;
    juce::dsp::ProcessorDuplicator<juce::dsp::IIR::Filter<float>, juce::dsp::IIR::Coefficients<float>> highShelf;
};

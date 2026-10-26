#include "VoiceManager.h"

VoiceManager::VoiceManager()
{
    synthVoices.resize(MAX_SYNTH_VOICES);
    physVoices.resize(MAX_PHYS_VOICES);
    vocalVoices.resize(MAX_VOCAL_VOICES);
}

void VoiceManager::prepare(double sampleRate)
{
    currentSampleRate = sampleRate;
    for (auto& tv : synthVoices)  tv.voice.prepare(sampleRate);
    for (auto& pv : physVoices)   pv.voice.prepare(sampleRate);
    for (auto& vv : vocalVoices)  vv.voice.prepare(sampleRate);
    reset();
}

void VoiceManager::reset()
{
    for (auto& tv : synthVoices)
    {
        tv.trackId.clear();
        tv.voice.reset();
    }
    for (auto& pv : physVoices)
    {
        pv.trackId.clear();
        pv.voice.reset();
    }
    for (auto& vv : vocalVoices)
    {
        vv.trackId.clear();
        vv.voice.reset();
    }
    nextSynthVoiceIndex = 0;
    nextPhysVoiceIndex = 0;
    nextVocalVoiceIndex = 0;
}

void VoiceManager::noteOnSynth(const juce::String& trackId,
                               int noteId,
                               float pitchMidi,
                               float velocity,
                               float durationSeconds,
                               const juce::String& presetName,
                               SynthVoice::OscType oscType,
                               float attack, float decay, float sustain, float release,
                               float targetPitchMidi,
                               float slideTimeSeconds,
                               float vibratoDepthCents,
                               float vibratoRateHz,
                               float tremoloDepth,
                               float tremoloRateHz,
                               float filterStartHz,
                               float filterEndHz,
                               float filterSweepTimeSeconds,
                               const EnvelopeCurve* customDecayCurve,
                               const EnvelopeCurve* customReleaseCurve,
                               const musegrid::NoteExpression& expression)
{
    // Find free voice or round-robin steal
    int index = -1;
    for (int i = 0; i < MAX_SYNTH_VOICES; ++i)
    {
        int check = (nextSynthVoiceIndex + i) % MAX_SYNTH_VOICES;
        if (!synthVoices[check].voice.isActive())
        {
            index = check;
            break;
        }
    }
    if (index == -1)
    {
        index = nextSynthVoiceIndex;
    }
    nextSynthVoiceIndex = (index + 1) % MAX_SYNTH_VOICES;

    auto& tv = synthVoices[index];
    tv.trackId = trackId;
    tv.fxChainId = expression.fxChainId;

    if (presetName.isNotEmpty() && presetName != "custom")
    {
        tv.voice.setPreset(presetName);
    }

    // Always apply customized oscillator and ADSR if specified or modified:
    if ((int)oscType >= 0)
        tv.voice.setOscType(oscType);
    if (attack >= 0.0f && decay >= 0.0f)
        tv.voice.setAdsr(attack, decay, sustain, release);

    if (customDecayCurve)
        tv.voice.setDecayCurve(*customDecayCurve);
    if (customReleaseCurve)
        tv.voice.setReleaseCurve(*customReleaseCurve);

    tv.voice.triggerNoteOn(noteId, pitchMidi, velocity, durationSeconds,
                           targetPitchMidi, slideTimeSeconds,
                           vibratoDepthCents, vibratoRateHz,
                           tremoloDepth, tremoloRateHz,
                           filterStartHz, filterEndHz, filterSweepTimeSeconds,
                           expression);
}

void VoiceManager::noteOnPhysical(const juce::String& trackId,
                                  int noteId,
                                  float pitchMidi,
                                  float velocity,
                                  float durationSeconds,
                                  float damping,
                                  float pluckPos,
                                  int fxChainId,
                                  const musegrid::NoteExpression& expression,
                                  float targetPitchMidi,
                                  float slideTimeSeconds)
{
    int index = nextPhysVoiceIndex;
    for (int i = 0; i < MAX_PHYS_VOICES; ++i)
    {
        int check = (nextPhysVoiceIndex + i) % MAX_PHYS_VOICES;
        if (!physVoices[check].voice.isActive())
        {
            index = check;
            break;
        }
    }
    nextPhysVoiceIndex = (index + 1) % MAX_PHYS_VOICES;

    auto& pv = physVoices[index];
    pv.trackId = trackId;
    pv.fxChainId = fxChainId != 0 ? fxChainId : expression.fxChainId;
    pv.voice.triggerPluck(noteId, pitchMidi, velocity, durationSeconds, damping, pluckPos, 0.0f,
                          expression, targetPitchMidi, slideTimeSeconds);
}

void VoiceManager::noteOnVocal(const juce::String& trackId,
                               int noteId,
                               float pitchMidi,
                               float velocity,
                               float durationSeconds,
                               const juce::String& vowel,
                               float tractLength,
                               float breathiness,
                               float tension,
                               int fxChainId,
                               const musegrid::NoteExpression& expression,
                               float targetPitchMidi,
                               float slideTimeSeconds)
{
    int index = nextVocalVoiceIndex;
    for (int i = 0; i < MAX_VOCAL_VOICES; ++i)
    {
        int check = (nextVocalVoiceIndex + i) % MAX_VOCAL_VOICES;
        if (!vocalVoices[check].voice.isActive())
        {
            index = check;
            break;
        }
    }
    nextVocalVoiceIndex = (index + 1) % MAX_VOCAL_VOICES;

    auto& vv = vocalVoices[index];
    vv.trackId = trackId;
    vv.fxChainId = fxChainId != 0 ? fxChainId : expression.fxChainId;
    vv.voice.triggerVocal(noteId, pitchMidi, velocity, durationSeconds, vowel, tractLength,
                          breathiness, tension, 30.0f, 5.5f, expression,
                          targetPitchMidi, slideTimeSeconds);
}

void VoiceManager::noteOff(const juce::String& trackId, int noteId)
{
    for (auto& tv : synthVoices)
    {
        if (tv.trackId == trackId && (noteId < 0 || tv.voice.getNoteId() == noteId))
        {
            tv.voice.triggerNoteOff();
        }
    }
    for (auto& pv : physVoices)
    {
        if (pv.trackId == trackId && (noteId < 0 || pv.voice.getNoteId() == noteId))
        {
            pv.voice.triggerNoteOff();
        }
    }
    for (auto& vv : vocalVoices)
    {
        if (vv.trackId == trackId && (noteId < 0 || vv.voice.getNoteId() == noteId))
        {
            vv.voice.triggerNoteOff();
        }
    }
}

void VoiceManager::allNotesOff()
{
    for (auto& tv : synthVoices) tv.voice.stopImmediately();
    for (auto& pv : physVoices) pv.voice.stopImmediately();
    for (auto& vv : vocalVoices) vv.voice.stopImmediately();
}

void VoiceManager::killAllNotesOnTrack(const juce::String& trackId)
{
    for (auto& tv : synthVoices)
        if (tv.trackId == trackId) tv.voice.stopImmediately();
    for (auto& pv : physVoices)
        if (pv.trackId == trackId) pv.voice.stopImmediately();
    for (auto& vv : vocalVoices)
        if (vv.trackId == trackId) vv.voice.stopImmediately();
}

void VoiceManager::renderVoices(const juce::String& trackId, float* leftOut, float* rightOut, int numSamples,
                                float trackPan, float trackVol, int fxChainId)
{
    for (auto& tv : synthVoices)
    {
        if (tv.trackId == trackId && tv.fxChainId == fxChainId && tv.voice.isActive())
        {
            tv.voice.renderBlock(leftOut, rightOut, numSamples, trackPan, trackVol);
        }
    }
    for (auto& pv : physVoices)
    {
        if (pv.trackId == trackId && pv.fxChainId == fxChainId && pv.voice.isActive())
        {
            pv.voice.renderBlock(leftOut, rightOut, numSamples, trackPan, trackVol);
        }
    }
    for (auto& vv : vocalVoices)
    {
        if (vv.trackId == trackId && vv.fxChainId == fxChainId && vv.voice.isActive())
        {
            vv.voice.renderBlock(leftOut, rightOut, numSamples, trackPan, trackVol);
        }
    }
}

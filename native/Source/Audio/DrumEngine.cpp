#include "DrumEngine.h"

DrumEngine::DrumEngine()
{
    voices.resize(MAX_DRUM_VOICES);

    // Initialize default acoustic exponential curves
    padCurves[0].setExponential(-4.5f);  // Kick
    padCurves[1].setExponential(-5.5f);  // Snare
    padCurves[2].setExponential(-7.0f);  // Closed Hat
    padCurves[3].setExponential(-3.5f);  // Open Hat
    padCurves[4].setExponential(-4.5f);  // Clap
    padCurves[5].setExponential(-4.0f);  // Low Tom
    padCurves[6].setExponential(-4.2f);  // Mid Tom
    padCurves[7].setExponential(-4.5f);  // High Tom
    padCurves[8].setExponential(-2.5f);  // Crash
    padCurves[9].setExponential(-2.8f);  // Ride
    padCurves[10].setExponential(-4.0f); // Cowbell
    padCurves[11].setExponential(-6.0f); // Tambourine
    padCurves[12].setExponential(-4.0f); // Lo-Conga
    padCurves[13].setExponential(-4.0f); // Hi-Conga
    padCurves[14].setExponential(-6.0f); // Claves
    padCurves[15].setExponential(-6.5f); // Rimshot
}

void DrumEngine::prepare(double sampleRate)
{
    currentSampleRate = sampleRate;
    reset();
}

void DrumEngine::reset()
{
    for (auto& v : voices)
    {
        v.active = false;
        v.elapsedSeconds = 0.0f;
    }
}

void DrumEngine::setKitByName(const juce::String& kitName)
{
    auto lower = kitName.toLowerCase();
    if (lower.contains("tight"))        currentKit = KitType::Tight;
    else if (lower.contains("808") || lower.contains("eightoh")) currentKit = KitType::EightOhEight;
    else if (lower.contains("electro")) currentKit = KitType::Electro;
    else if (lower.contains("tabla"))   currentKit = KitType::Tabla;
    else                                currentKit = KitType::Default;
}

float DrumEngine::nextNoise(juce::uint32& seed)
{
    seed = (seed * 196314165 + 907633515);
    return ((float)(seed >> 16) / 32768.0f) - 1.0f;
}

static inline int normalizeDrumPad(int pad)
{
    // Standard General MIDI drum note mapping (35-81) to 16 pads
    if (pad >= 35 && pad <= 81)
    {
        switch (pad)
        {
            case 35: case 36: return 0;  // Acoustic / Bass Drum -> Kick
            case 38: case 40: return 1;  // Acoustic / Electric Snare -> Snare
            case 37:          return 15; // Side Stick -> Rimshot
            case 39:          return 4;  // Hand Clap -> Clap
            case 41: case 43: case 45: return 5; // Low Toms -> Low Tom
            case 47: case 48: return 6;  // Mid Toms -> Mid Tom
            case 50:          return 7;  // High Tom -> High Tom
            case 42: case 44: return 2;  // Closed / Pedal Hi-Hat -> Closed Hat
            case 46:          return 3;  // Open Hi-Hat -> Open Hat
            case 49: case 52: case 55: case 57: return 8; // Crash / Splash -> Crash
            case 51: case 53: case 59: return 9; // Ride / Ride Bell -> Ride
            case 56:          return 10; // Cowbell
            case 54:          return 11; // Tambourine
            case 64:          return 12; // Low Conga -> Lo-Conga
            case 63:          return 13; // High Conga -> Hi-Conga
            case 75:          return 14; // Claves
            default:          return ((pad % 16) + 16) % 16;
        }
    }
    return ((pad % 16) + 16) % 16;
}

void DrumEngine::triggerHit(int drumPad, float velocity, float pitchOffsetSemitones, float customDecaySeconds, float slideSemitones, float slideTime, float punchOctaves, float resonanceHz)
{
    // Find free or oldest voice
    int bestIndex = 0;
    float maxElapsed = -1.0f;

    for (size_t i = 0; i < voices.size(); ++i)
    {
        if (!voices[i].active)
        {
            bestIndex = (int)i;
            break;
        }
        if (voices[i].elapsedSeconds > maxElapsed)
        {
            maxElapsed = voices[i].elapsedSeconds;
            bestIndex = (int)i;
        }
    }

    auto& v = voices[bestIndex];
    v.active = true;
    v.drumPad = normalizeDrumPad(drumPad);
    v.velocity = juce::jlimit(0.0f, 1.0f, velocity);
    v.elapsedSeconds = 0.0f;
    v.phase = 0.0;
    v.phase2 = 0.0;
    for (int k = 0; k < 6; ++k) v.metalPhases[k] = 0.0;
    v.filterState = 0.0f;
    v.filterState2 = 0.0f;
    v.noiseSeed = (juce::uint32)(123456 + bestIndex * 789);

    v.slideSemitones = slideSemitones;
    v.slideTimeSeconds = slideTime > 0.001f ? slideTime : 0.12f;
    v.filterCutoffHz = resonanceHz > 50.0f ? resonanceHz : 4000.0f;

    const float pitchMultiplier = std::pow(2.0f, pitchOffsetSemitones / 12.0f);

    // Configure pad parameters based on pad & kit
    switch (v.drumPad)
    {
        case 0: // Kick
            if (currentKit == KitType::EightOhEight) {
                v.startFreq = 160.0f * pitchMultiplier;
                v.endFreq = 38.0f * pitchMultiplier;
                v.pitchDecay = 0.09f;
                v.durationSeconds = 0.8f;
            } else if (currentKit == KitType::Tight) {
                v.startFreq = 180.0f * pitchMultiplier;
                v.endFreq = 55.0f * pitchMultiplier;
                v.pitchDecay = 0.03f;
                v.durationSeconds = 0.25f;
            } else if (currentKit == KitType::Tabla) { // Bayan (Bass Ghe)
                v.startFreq = 70.0f * pitchMultiplier;
                v.endFreq = 95.0f * pitchMultiplier; // Upward pitch modulation
                v.pitchDecay = 0.2f;
                v.durationSeconds = 0.7f;
            } else {
                v.startFreq = 150.0f * pitchMultiplier;
                v.endFreq = 48.0f * pitchMultiplier;
                v.pitchDecay = 0.045f;
                v.durationSeconds = 0.4f;
            }
            break;

        case 1: // Snare
            v.durationSeconds = (currentKit == KitType::Tight) ? 0.15f : 0.3f;
            v.startFreq = 220.0f * pitchMultiplier;
            v.endFreq = 140.0f * pitchMultiplier;
            v.pitchDecay = 0.03f;
            break;

        case 2: // Closed Hi-Hat
            v.durationSeconds = (currentKit == KitType::Tight) ? 0.04f : 0.07f;
            v.startFreq = 8000.0f * pitchMultiplier;
            break;

        case 3: // Open Hi-Hat
            v.durationSeconds = (currentKit == KitType::EightOhEight) ? 0.65f : 0.4f;
            v.startFreq = 7500.0f * pitchMultiplier;
            break;

        case 4: // Hand Clap
            v.durationSeconds = 0.25f;
            v.startFreq = 1200.0f * pitchMultiplier;
            break;

        case 5: // Low Tom
            v.durationSeconds = 0.4f;
            v.startFreq = 110.0f * pitchMultiplier;
            v.endFreq = 65.0f * pitchMultiplier;
            v.pitchDecay = 0.1f;
            break;

        case 6: // Mid Tom
            v.durationSeconds = 0.35f;
            v.startFreq = 150.0f * pitchMultiplier;
            v.endFreq = 95.0f * pitchMultiplier;
            v.pitchDecay = 0.08f;
            break;

        case 7: // High Tom
            v.durationSeconds = 0.3f;
            v.startFreq = 210.0f * pitchMultiplier;
            v.endFreq = 135.0f * pitchMultiplier;
            v.pitchDecay = 0.06f;
            break;

        case 8: // Crash Cymbal
            v.durationSeconds = 1.6f;
            v.startFreq = 300.0f * pitchMultiplier;
            break;

        case 9: // Ride Cymbal
            v.durationSeconds = 1.2f;
            v.startFreq = 400.0f * pitchMultiplier;
            break;

        case 10: // Cowbell
            v.durationSeconds = 0.25f;
            v.startFreq = 587.0f * pitchMultiplier; // A4
            v.endFreq = 845.0f * pitchMultiplier;   // F5
            break;

        case 11: // Tambourine
            v.durationSeconds = 0.15f;
            v.startFreq = 6500.0f * pitchMultiplier;
            break;

        case 12: // Lo-Conga (E2 = 82.4 Hz)
            v.durationSeconds = 0.35f;
            v.startFreq = 165.0f * pitchMultiplier;
            v.endFreq = 82.4f * pitchMultiplier;
            v.pitchDecay = 0.04f;
            break;

        case 13: // Hi-Conga (G2 = 98.0 Hz)
            v.durationSeconds = 0.28f;
            v.startFreq = 220.0f * pitchMultiplier;
            v.endFreq = 98.0f * pitchMultiplier;
            v.pitchDecay = 0.035f;
            break;

        case 14: // Claves
            v.durationSeconds = 0.08f;
            v.startFreq = 2500.0f * pitchMultiplier;
            v.endFreq = 2500.0f * pitchMultiplier;
            break;

        case 15: // Rimshot
            v.durationSeconds = 0.08f;
            v.startFreq = 800.0f * pitchMultiplier;
            v.endFreq = 320.0f * pitchMultiplier;
            v.pitchDecay = 0.012f;
            break;

        default:
            v.durationSeconds = 0.3f;
            v.startFreq = 200.0f;
            v.endFreq = 80.0f;
            break;
    }

    if (customDecaySeconds > 0.0f)
    {
        v.durationSeconds = customDecaySeconds;
    }
    if (punchOctaves > 0.0f && (v.drumPad == 0 || v.drumPad == 5 || v.drumPad == 6 || v.drumPad == 7 || v.drumPad == 12 || v.drumPad == 13))
    {
        v.startFreq = v.endFreq * std::pow(2.0f, punchOctaves);
    }
}

void DrumEngine::renderBlock(float* leftOut, float* rightOut, int numSamples, float trackPan, float trackVol)
{
    const float sampleTime = 1.0f / (float)currentSampleRate;
    const float panAngle = (trackPan + 1.0f) * 0.25f * juce::MathConstants<float>::pi;
    const float leftGain = std::cos(panAngle) * trackVol;
    const float rightGain = std::sin(panAngle) * trackVol;

    for (auto& v : voices)
    {
        if (!v.active) continue;

        for (int i = 0; i < numSamples; ++i)
        {
            v.elapsedSeconds += sampleTime;
            if (v.elapsedSeconds >= v.durationSeconds)
            {
                v.active = false;
                break;
            }

            const float t = v.elapsedSeconds;
            const float progress = juce::jlimit(0.0f, 1.0f, t / v.durationSeconds);
            const float padAmp = padCurves[v.drumPad].sample(progress);
            const float slideMultiplier = (v.slideSemitones != 0.0f && v.slideTimeSeconds > 0.001f)
                ? std::pow(2.0f, (v.slideSemitones * juce::jlimit(0.0f, 1.0f, t / v.slideTimeSeconds)) / 12.0f)
                : 1.0f;
            float sample = 0.0f;

            switch (v.drumPad)
            {
                case 0: // Kick Drum
                {
                    const float pitchEnv = std::exp(-t / v.pitchDecay);
                    const float freq = (v.endFreq + (v.startFreq - v.endFreq) * pitchEnv) * slideMultiplier;
                    v.phase += 2.0 * juce::MathConstants<double>::pi * freq * sampleTime;
                    sample = (float)std::sin(v.phase) * padAmp;
                    // Add subtle click transient
                    if (t < 0.005f) sample += nextNoise(v.noiseSeed) * (1.0f - t / 0.005f) * 0.3f;
                    break;
                }

                case 1: // Snare Drum
                {
                    const float bodyPitch = (v.endFreq + (v.startFreq - v.endFreq) * std::exp(-t / v.pitchDecay)) * slideMultiplier;
                    v.phase += 2.0 * juce::MathConstants<double>::pi * bodyPitch * sampleTime;
                    const float body = (float)std::sin(v.phase) * padAmp * 0.6f;
                    const float noise = nextNoise(v.noiseSeed) * padAmp * 0.7f;
                    sample = body + noise;
                    break;
                }

                case 2: // Closed Hi-Hat
                case 3: // Open Hi-Hat
                case 8: // Crash Cymbal
                case 9: // Ride Cymbal
                {
                    static const float metalRatios[6] = { 1.0f, 1.483f, 1.932f, 2.546f, 2.630f, 3.897f };
                    float metalSum = 0.0f;
                    for (int k = 0; k < 6; ++k)
                    {
                        const float baseF = v.startFreq;
                        v.metalPhases[k] += 2.0 * juce::MathConstants<double>::pi * (baseF * metalRatios[k]) * sampleTime;
                        if (v.metalPhases[k] >= 2.0 * juce::MathConstants<double>::pi)
                            v.metalPhases[k] -= 2.0 * juce::MathConstants<double>::pi;
                        metalSum += (std::sin(v.metalPhases[k]) > 0.0 ? 0.35f : -0.35f);
                    }
                    const float noise = nextNoise(v.noiseSeed) * 0.4f;
                    const float combined = metalSum + noise;
                    const float filterAlpha = juce::jlimit(0.02f, 0.95f, (float)(2.0 * juce::MathConstants<double>::pi * (double)v.filterCutoffHz * sampleTime));
                    v.filterState += filterAlpha * (combined - v.filterState);
                    sample = (combined - v.filterState) * padAmp * 0.85f;
                    break;
                }

                case 4: // Hand Clap
                {
                    // Multi-trigger burst envelope
                    float clapEnv = 0.0f;
                    if (t < 0.012f) clapEnv = std::exp(-t / 0.004f);
                    else if (t < 0.024f) clapEnv = std::exp(-(t - 0.012f) / 0.004f);
                    else if (t < 0.036f) clapEnv = std::exp(-(t - 0.024f) / 0.004f);
                    else clapEnv = std::exp(-(t - 0.036f) / 0.06f);

                    const float noise = nextNoise(v.noiseSeed);
                    const float filterAlpha = juce::jlimit(0.02f, 0.95f, (float)(2.0 * juce::MathConstants<double>::pi * (double)v.filterCutoffHz * sampleTime));
                    v.filterState += filterAlpha * (noise - v.filterState);
                    sample = v.filterState * clapEnv * padAmp * 0.8f;
                    break;
                }

                case 5: // Toms (5, 6, 7)
                case 6:
                case 7:
                {
                    const float freq = (v.endFreq + (v.startFreq - v.endFreq) * std::exp(-t / v.pitchDecay)) * slideMultiplier;
                    v.phase += 2.0 * juce::MathConstants<double>::pi * freq * sampleTime;
                    sample = (float)std::sin(v.phase) * padAmp * 0.8f;
                    break;
                }

                case 10: // Cowbell
                {
                    // Dual pulse waves with dynamically transposed and slid frequencies
                    v.phase += 2.0 * juce::MathConstants<double>::pi * (double)(v.startFreq * slideMultiplier) * sampleTime;
                    v.phase2 += 2.0 * juce::MathConstants<double>::pi * (double)(v.endFreq * slideMultiplier) * sampleTime;
                    const float sq1 = std::sin(v.phase) > 0.0 ? 1.0f : -1.0f;
                    const float sq2 = std::sin(v.phase2) > 0.0 ? 1.0f : -1.0f;
                    sample = (sq1 + sq2) * 0.4f * padAmp;
                    break;
                }

                case 11: // Tambourine
                {
                    const float noise = nextNoise(v.noiseSeed);
                    const float filterAlpha = juce::jlimit(0.02f, 0.95f, (float)(2.0 * juce::MathConstants<double>::pi * (double)v.filterCutoffHz * sampleTime));
                    v.filterState += filterAlpha * (noise - v.filterState);
                    sample = v.filterState * padAmp * 0.6f;
                    break;
                }

                case 12: // Lo-Conga
                case 13: // Hi-Conga
                {
                    const float freq = (v.endFreq + (v.startFreq - v.endFreq) * std::exp(-t / v.pitchDecay)) * slideMultiplier;
                    v.phase += 2.0 * juce::MathConstants<double>::pi * freq * sampleTime;
                    sample = (float)std::sin(v.phase) * padAmp * 0.85f;
                    break;
                }

                case 14: // Claves
                {
                    v.phase += 2.0 * juce::MathConstants<double>::pi * (double)v.startFreq * sampleTime;
                    sample = (float)std::sin(v.phase) * padAmp * 0.7f;
                    break;
                }

                case 15: // Rimshot
                {
                    const float noise = nextNoise(v.noiseSeed);
                    const float noiseBurst = noise * (t < 0.01f ? 1.0f - t / 0.01f : 0.0f);
                    const float bodyPitch = v.endFreq + (v.startFreq - v.endFreq) * std::exp(-t / v.pitchDecay);
                    v.phase += 2.0 * juce::MathConstants<double>::pi * bodyPitch * sampleTime;
                    const float body = (float)std::sin(v.phase) * 0.6f;
                    sample = (noiseBurst * 0.8f + body) * padAmp * 0.75f;
                    break;
                }

                default: // Catch-all fallback
                {
                    const float freq = v.endFreq + (v.startFreq - v.endFreq) * std::exp(-t / 0.05f);
                    v.phase += 2.0 * juce::MathConstants<double>::pi * freq * sampleTime;
                    const float amp = std::exp(-t / (v.durationSeconds * 0.35f));
                    sample = (float)std::sin(v.phase) * amp * 0.7f;
                    break;
                }
            }

            const float finalVal = sample * v.velocity;
            leftOut[i] += finalVal * leftGain;
            rightOut[i] += finalVal * rightGain;
        }
    }
}

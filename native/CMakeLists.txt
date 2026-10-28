cmake_minimum_required(VERSION 3.22)
project(MuseGrid VERSION 1.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE CMake Integration
add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../JUCE" JUCE)

# Set Windows WebView2 package directory hint
if(WIN32)
    set(JUCE_WEBVIEW2_PACKAGE_LOCATION "$ENV{USERPROFILE}/AppData/Local/PackageManagement/NuGet/Packages" CACHE PATH "Path to NuGet WebView2 package")
endif()

# Define the Standalone GUI Application
juce_add_gui_app(MuseGrid
    NEEDS_WEBVIEW2 TRUE
    PRODUCT_NAME "MuseGrid"
    VERSION "1.1.0"
    COMPANY_NAME "MuseGrid"
    BUNDLE_IDENTIFIER "com.musegrid.app"
)

set(MuseGridJuceLinkLibs
    juce::juce_core
    juce::juce_events
    juce::juce_graphics
    juce::juce_data_structures
    juce::juce_gui_basics
    juce::juce_gui_extra
    juce::juce_audio_basics
    juce::juce_audio_devices
    juce::juce_audio_formats
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_dsp
)

# DSP + rendering layer, shared by the app and the headless offline-render test
set(MuseGridAudioSources
    Source/Audio/AudioEngine.h
    Source/Audio/AudioEngine.cpp
    Source/Audio/Vst3Host.h
    Source/Audio/Vst3Host.cpp
    Source/Audio/EnvelopeCurve.h
    Source/Audio/VoiceManager.h
    Source/Audio/VoiceManager.cpp
    Source/Audio/SynthVoice.h
    Source/Audio/SynthVoice.cpp
    Source/Audio/DrumEngine.h
    Source/Audio/DrumEngine.cpp
    Source/Audio/SampleEngine.h
    Source/Audio/SampleEngine.cpp
    Source/Audio/PhysicalModelVoice.h
    Source/Audio/PhysicalModelVoice.cpp
    Source/Audio/VocalModelVoice.h
    Source/Audio/VocalModelVoice.cpp
    Source/Audio/OfflineRenderer.h
    Source/Audio/OfflineRenderer.cpp
    Source/Audio/Effects/DelayEffect.h
    Source/Audio/Effects/ReverbEffect.h
    Source/Audio/Effects/DistortionEffect.h
    Source/Audio/Effects/FilterEffect.h
    Source/Audio/Effects/LimiterEffect.h
    Source/Audio/Effects/ChorusEffect.h
    Source/Audio/Effects/PhaserEffect.h
    Source/Audio/Effects/EQEffect.h
)

target_sources(MuseGrid PRIVATE
    Source/Main.cpp
    ${MuseGridAudioSources}
    Source/Bridge/JuceBridge.h
    Source/Bridge/JuceBridge.cpp
    Source/Resources/resource.rc
)

target_compile_definitions(MuseGrid PRIVATE
    JUCE_USE_WIN_WEBVIEW2=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_WEB_BROWSER_RESOURCE_PROVIDER_AVAILABLE=1
    JUCE_STRICT_REFCOUNTEDPOINTER=1
    JUCE_PLUGINHOST_VST3=1
    JUCE_ASIO=1
    JUCE_WASAPI=1
    JUCE_WASAPI_EXCLUSIVE=1
    JUCE_DIRECTSOUND=1
    JUCE_APPLICATION_NAME_STRING="MuseGrid"
    JUCE_APPLICATION_VERSION_STRING="1.1.0"
    NOMINMAX
    WIN32_LEAN_AND_MEAN
)

target_include_directories(MuseGrid PRIVATE
    Source
    Source/Audio
    Source/Audio/Effects
    Source/Bridge
)

target_link_libraries(MuseGrid PRIVATE ${MuseGridJuceLinkLibs})

if(MSVC)
    target_compile_options(MuseGrid PRIVATE /W3 /fp:fast /utf-8 /EHsc)
endif()

# Headless check of the offline bounce: ninja -C build TestOfflineRender
add_executable(TestOfflineRender EXCLUDE_FROM_ALL
    Source/Tests/OfflineRenderTest.cpp
    ${MuseGridAudioSources}
)

set_target_properties(TestOfflineRender PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
)

target_compile_definitions(TestOfflineRender PRIVATE
    JUCE_STRICT_REFCOUNTEDPOINTER=1
    JUCE_PLUGINHOST_VST3=1
    JUCE_DISPLAY_SPLASH_SCREEN=0
    JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1
    JUCE_MODULE_avx_producer=0
    JUCE_USE_WIN_WEBVIEW2=0
    NOMINMAX
    WIN32_LEAN_AND_MEAN
    DONT_USE_BARE_FAIL_TEST_CLASS
)

target_include_directories(TestOfflineRender PRIVATE
    Source
    Source/Audio
    Source/Audio/Effects
)

target_link_libraries(TestOfflineRender PRIVATE ${MuseGridJuceLinkLibs})

if(MSVC)
    target_compile_options(TestOfflineRender PRIVATE /W3 /fp:fast /utf-8 /EHsc)
endif()

require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'PenguLiveStream'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'PenguLive'
  s.homepage       = 'https://github.com/Hasantunaozdmr/PenguChat'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Hasantunaozdmr/PenguChat.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.resource_bundles = { 'PenguLiveAssets' => ['assets/*.png'] }
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # HaishinKit (açık kaynak, BSD-3): kamera + mikrofon → RTMP/RTMPS, logo / resim / ikinci kamera
  # Sadece Swift Package Manager ile dağıtılıyor; React Native'in yardımcısıyla bağlanır.
  if defined?(spm_dependency)
    spm_dependency(s,
      url: 'https://github.com/HaishinKit/HaishinKit.swift.git',
      requirement: { kind: 'upToNextMinorVersion', minimumVersion: '2.2.5' },
      products: ['HaishinKit', 'RTMPHaishinKit']
    )
  end
end

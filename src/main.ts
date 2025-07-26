import {
  RegisterServerOptions,
  RegisterServerSettingOptions
}
from '@peertube/peertube-types'

// The constant for the single profile name
const PROFILE_NAME = 'human-transcoding'

// A robust function to parse a string of options into an array for FFmpeg
function parseOptionsString (optionsStr: string): string[] {
  if (!optionsStr) return []
  // This regex correctly handles quoted arguments
  return optionsStr.match(/([^\s"']+|"([^"]*)"|'([^']*)')+/g) || []
}

async function register (options: RegisterServerOptions): Promise<void> {
  const { registerSetting, settingsManager, transcodingManager } = options
  const logger = options.peertubeHelpers.logger

  logger.info('Registering Human Transcoding Settings Plugin...')

  const resolutions = [ '144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p' ]
  // We build a definitive list of all setting names to fetch them later
  const settingNames = [ 'audio_codec', 'audio_params' ]

  const settingsToRegister: RegisterServerSettingOptions[] = [
    {
      name: 'audio_codec',
      label: 'Audio codec',
      type: 'input',
      default: 'aac',
      private: false,
      descriptionHTML: 'Enter the FFmpeg audio codec name (e.g., `aac`, `libopus`).'
    },
    {
      name: 'audio_params',
      label: 'Audio codec parameters',
      type: 'input',
      default: '-b:a 192k',
      private: false,
      descriptionHTML: 'Enter the parameters for the audio codec (e.g., `-b:a 192k`).'
    }
  ]

  for (const res of resolutions) {
    const resSettings = [
      `resolution_${res}_codec`,
      `resolution_${res}_input_params`,
      `resolution_${res}_codec_params`
    ]
    settingNames.push(...resSettings)

    settingsToRegister.push(
      {
        name: `resolution_${res}_codec`,
        label: `Video codec for ${res}`,
        type: 'input',
        default: 'libx264',
        private: false,
        descriptionHTML: `<hr><h3>Settings for ${res}</h3>FFmpeg video codec name (e.g., \`libx264\`, \`h264_rkmpp\`, \`hevc_vaapi\`).`
      },
      {
        name: `resolution_${res}_input_params`,
        label: `Input parameters for ${res} (before codec)`,
        type: 'input',
        default: '',
        private: false,
        descriptionHTML: 'Parameters added before the video codec. Ideal for hardware acceleration flags.'
      },
      {
        name: `resolution_${res}_codec_params`,
        label: `Video codec parameters for ${res}`,
        type: 'input-textarea',
        default: res.includes('p') && parseInt(res, 10) >= 1080
          ? '-crf 23 -preset medium'
          : '-crf 23 -preset fast',
        private: false,
        descriptionHTML: 'Parameters for the video codec itself. E.g., `-crf 23 -preset fast` for `libx264`, or `-qp 24` for a hardware encoder.'
      }
    )
  }

  for (const setting of settingsToRegister) {
    registerSetting(setting)
  }

  // Register the audio part of our custom profile
  transcodingManager.addVODProfile('aac', PROFILE_NAME, async () => {
    const settings = await settingsManager.getSettings([ 'audio_params' ])
    const audioParams = parseOptionsString(settings.audio_params as string)
    return { inputOptions: [], outputOptions: audioParams }
  })

  // Register the video part of our custom profile.
  // We use a placeholder codec name here because the real codec will be specified in the arguments.
  transcodingManager.addVODProfile('placeholder-video-codec', PROFILE_NAME, async (vodOptions) => {
    // Змінено: assuming vodOptions.resolution is directly the height (number)
    const resolutionHeight = vodOptions.resolution;
    const resKey = `${resolutionHeight}p`;

    // Fetch the specific settings for this resolution
    const settings = await settingsManager.getSettings([
      `resolution_${resKey}_codec`,
      `resolution_${resKey}_input_params`,
      `resolution_${resKey}_codec_params`
    ])

    const codec = settings[`resolution_${resKey}_codec`] as string
    const inputParams = parseOptionsString(settings[`resolution_${resKey}_input_params`] as string)
    const codecParams = parseOptionsString(settings[`resolution_${resKey}_codec_params`] as string)

    if (!codec) {
      logger.warn(`'${PROFILE_NAME}' is active for ${resKey}, but no codec is configured. Using fallback.`)
      return { inputOptions: [], outputOptions: [ '-c:v', 'libx264', '-crf', '23' ] }
    }

    logger.info(`Building '${PROFILE_NAME}' for ${resKey} with ${codec} codec.`)

    // We build the entire command here, including the '-c:v' flag with the real codec
    return {
      inputOptions: inputParams,
      outputOptions: [ '-c:v', codec, ...codecParams ]
    }
  })

  // Set high priority for our profile's codecs to ensure they are chosen
  transcodingManager.addVODEncoderPriority('audio', 'aac', 2000)
  transcodingManager.addVODEncoderPriority('video', 'placeholder-video-codec', 2000)
}

async function unregister (options: RegisterServerOptions): Promise<void> {
  // This is the correct method to remove all profiles and priorities registered by the plugin
  options.transcodingManager.removeAllProfilesAndEncoderPriorities()
}

export {
  register,
  unregister
}

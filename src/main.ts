import {
  RegisterServerOptions,
  PluginTranscodingManager,
  PluginSettingsManager,
  RegisterServerSettingOptions
} from '@peertube/peertube-types'

// Глобальний контекст для зберігання посилань на менеджери з правильними типами
const pluginContext: {
  transcodingManager: PluginTranscodingManager | null
  settingsManager: PluginSettingsManager | null
  logger: RegisterServerOptions['peertubeHelpers']['logger'] | null
  settingNames: string[]
} = {
  transcodingManager: null,
  settingsManager: null,
  logger: null,
  settingNames: []
}

// Більш проста і надійна функція для парсингу рядка параметрів
function parseOptionsString (optionsStr: string): string[] {
  if (!optionsStr) return []
  return optionsStr.match(/([^\s"']+|"([^"]*)"|'([^']*)')+/g) || []
}

// Основна функція, яка оновлює або створює профілі транскодування
async function updateTranscodingProfiles (initialSettings?: { [id: string]: any }) {
  const { transcodingManager, logger, settingsManager, settingNames } = pluginContext
  if (!transcodingManager || !logger || !settingsManager) return

  // Отримуємо налаштування або при першому запуску, або від слухача
  const settings = initialSettings || await settingsManager.getSettings(settingNames)

  transcodingManager.removeAllProfilesAndEncoderPriorities()

  const resolutions = [ '144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p' ]
  const audioCodec = (settings['audio_codec'] as string) || 'aac'
  const audioParams = (settings['audio_params'] as string) || '-b:a 128k'
  const transcodeThreads = parseInt(settings['transcode_threads'] as string, 10) || 0

  logger.info('Updating transcoding profiles based on new settings...')

  for (const res of resolutions) {
    const isEnabled = settings[`resolution_${res}_enabled`] as boolean
    if (!isEnabled) {
      logger.info(`Resolution ${res} is disabled, skipping.`)
      continue
    }

    const videoCodec = settings[`resolution_${res}_codec`] as string
    const inputParamsStr = (settings[`resolution_${res}_input_params`] as string) || ''
    const codecParamsStr = (settings[`resolution_${res}_codec_params`] as string) || ''
    const profileName = `custom-${res}-${videoCodec || 'default'}`

    if (!videoCodec) {
      logger.warn(`Video codec for resolution ${res} is not defined. Skipping.`)
      continue
    }

    const threadParams = transcodeThreads > 0 ? ['-threads', transcodeThreads.toString()] : []
    const inputParams = parseOptionsString(inputParamsStr)
    const codecParams = parseOptionsString(codecParamsStr)

    transcodingManager.addVODProfile(videoCodec, profileName, () => ({
      inputOptions: [ ...threadParams, ...inputParams ],
      outputOptions: codecParams
    }))

    transcodingManager.addVODProfile(audioCodec, profileName, () => ({
      inputOptions: [],
      outputOptions: parseOptionsString(audioParams)
    }))

    transcodingManager.addVODEncoderPriority('video', videoCodec, 2000)
    transcodingManager.addVODEncoderPriority('audio', audioCodec, 2000)

    logger.info(`Registered profile '${profileName}' for ${res} with video codec '${videoCodec}'.`)
  }
}

// --- Логіка реєстрації плагіна ---

async function register (options: RegisterServerOptions): Promise<void> {
  const { registerSetting, peertubeHelpers, transcodingManager, settingsManager } = options

  pluginContext.transcodingManager = transcodingManager
  pluginContext.logger = peertubeHelpers.logger
  pluginContext.settingsManager = settingsManager

  pluginContext.logger.info('Registering Universal Transcoder Plugin...')

  const resolutions = [ '144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p' ]
  const settingsToRegister: RegisterServerSettingOptions[] = []

  // Глобальні налаштування
  settingsToRegister.push(
    {
      name: 'audio_codec',
      label: 'Аудіокодек',
      type: 'input',
      default: 'aac',
      private: false,
      descriptionHTML: 'Введіть назву аудіокодека FFmpeg (наприклад, `aac`, `libopus`).'
    },
    {
      name: 'audio_params',
      label: 'Параметри аудіокодека',
      type: 'input',
      default: '-b:a 128k',
      private: false,
      descriptionHTML: 'Введіть параметри для аудіокодека (наприклад, `-b:a 192k`).'
    },
    {
      name: 'transcode_threads',
      label: 'Кількість потоків транскодування (0 = авто)',
      type: 'input',
      default: '0',
      private: false,
      descriptionHTML: 'Кількість потоків, які FFmpeg буде використовувати. 0 означає автоматичне визначення.'
    }
  )

  // Динамічне створення налаштувань для кожної роздільної здатності
  for (const res of resolutions) {
    settingsToRegister.push(
      {
        name: `resolution_${res}_enabled`,
        label: `Увімкнути транскодування в ${res}`,
        type: 'input-checkbox',
        default: res === '720p' || res === '1080p',
        private: false,
        descriptionHTML: `<hr><h3>Налаштування для ${res}</h3>`
      },
      {
        name: `resolution_${res}_codec`,
        label: `Відеокодек для ${res}`,
        type: 'input',
        default: 'libx264',
        private: false,
        descriptionHTML: 'Назва відеокодека FFmpeg (наприклад, `libx264`, `h264_rkmpp`, `hevc_vaapi`).'
      },
      {
        name: `resolution_${res}_input_params`,
        label: `Вхідні параметри для ${res} (до кодека)`,
        type: 'input',
        default: '',
        private: false,
        descriptionHTML: 'Параметри, що додаються перед відеокодеком. Ідеально для прапорів апаратного прискорення, наприклад: `-hwaccel vaapi -hwaccel_device /dev/dri/renderD128 -hwaccel_output_format vaapi`'
      },
      {
        name: `resolution_${res}_codec_params`,
        label: `Параметри відеокодека для ${res}`,
        type: 'input-textarea',
        default: res.includes('p') && parseInt(res, 10) >= 1080
          ? '-crf 23 -preset medium -pix_fmt yuv420p'
          : '-crf 23 -preset fast -pix_fmt yuv420p',
        private: false,
        descriptionHTML: 'Параметри для самого відеокодека. Наприклад: `-crf 23 -preset fast` для `libx264`, або `-qp 24 -profile:v main10` для `hevc_vaapi`.'
      }
    )
  }

  // Реєструємо всі налаштування
  for (const setting of settingsToRegister) {
    registerSetting(setting)
  }

  // Зберігаємо імена налаштувань для подальшого використання
  pluginContext.settingNames = settingsToRegister.map(s => s.name ?? 'default_name')

  // Слухач для "живого" перезавантаження налаштувань
  settingsManager.onSettingsChange(async (settings) => {
    await updateTranscodingProfiles(settings)
  })

  // Перший запуск при старті сервера
  await updateTranscodingProfiles()
}

async function unregister (): Promise<void> {
  const { transcodingManager, logger } = pluginContext
  if (transcodingManager && logger) {
    transcodingManager.removeAllProfilesAndEncoderPriorities()
    logger.info('All custom transcoding profiles have been unregistered.')
  }
}

export {
  register,
  unregister
}
import {
  PluginSettingsKeys,
  PluginSettings,
  PeerTubePlugin,
  RegisterSettingOptions
} from '@peertube/peertube-types';

const resolutions = [
  '144p',
  '240p',
  '360p',
  '480p',
  '720p',
  '1080p',
  '1440p',
  '2160p' // 4K
];

export async function register(
  this: PeerTubePlugin,
  settings: PluginSettings
) {
  this.logger.info('Registering custom transcoder plugin...');

  const registeredSettings: RegisterSettingOptions[] = [];

  // Global Audio settings
  registeredSettings.push({
    name: 'audio_codec',
    label: 'Аудіо кодек',
    type: 'string',
    default: 'aac',
    description: 'Введіть назву аудіокодека FFmpeg (наприклад, aac, libopus).'
  });

  registeredSettings.push({
    name: 'audio_params',
    label: 'Додаткові параметри FFmpeg для аудіокодека',
    type: 'string',
    default: '-b:a 128k',
    description:
      'Додаткові параметри FFmpeg для аудіокодека (наприклад, -b:a 128k).'
  });

  registeredSettings.push({
    name: 'transcode_threads',
    label: 'Кількість потоків транскодування (0 = авто)',
    type: 'number',
    default: 0,
    description:
      'Кількість потоків, які FFmpeg використовуватиме для транскодування. 0 означає автоматичне визначення.'
  });

  // Loop through each resolution to create dynamic settings
  for (const res of resolutions) {
    // Enable/Disable resolution
    registeredSettings.push({
      name: `resolution_${res}_enabled`,
      label: `Увімкнути ${res} транскодування`,
      type: 'boolean',
      default: true,
      description: `Чи включати ${res} роздільну здатність у налаштування транскодування.`
    });

    // Codec input for the resolution
    registeredSettings.push({
      name: `resolution_${res}_codec`,
      label: `Відеокодек для ${res}`,
      type: 'string',
      default: 'libx264',
      description: `Введіть назву відеокодека FFmpeg для ${res} (наприклад, libx264, libvpx-vp9, h264_qsv, h264_rkmpp).`
    });

    // Input parameters for video (e.g., for hardware acceleration)
    registeredSettings.push({
      name: `resolution_${res}_input_params`,
      label: `Параметри FFmpeg перед відеокодером для ${res}`,
      type: 'string',
      default: '',
      description: `Параметри, які додаються перед відеокодеком (наприклад, -hwaccel auto -hwaccel_device /dev/dri/renderD128).`
    });

    // Custom parameters for the selected codec
    registeredSettings.push({
      name: `resolution_${res}_codec_params`,
      label: `Додаткові параметри FFmpeg для ${res} відеокодека`,
      type: 'string',
      default: '-crf 23 -preset veryfast',
      description: `Додаткові параметри FFmpeg для відеокодека (${res}). Приклад: -crf 23 -preset veryfast. Для апаратного прискорювача: -qp 20`
    });

    // Output parameters/filters for video (e.g., scale filters for hardware)
    registeredSettings.push({
      name: `resolution_${res}_output_filters`,
      label: `Фільтри FFmpeg після відеокодека для ${res}`,
      type: 'string',
      default: '',
      description: `Фільтри FFmpeg, які додаються після відеокодека (наприклад, -vf "scale=w=%w:h=%h" або -vf "scale_rpi=w=%w:h=%h:mode=0"). %w і %h будуть замінені на ширину і висоту.`
    });
  }

  await this.settings.register(registeredSettings);

  // Hook into PeerTube's transcoding pipeline
  this.peertubeHelpers.transcoding.onFFmpegTranscoding(
    'on-video-transcoding',
    async (options) => {
      this.logger.info(`Processing video transcoding for ${options.input}`);

      const config: {
        audio_codec: string;
        audio_params: string;
        transcode_threads: number;
      } = await settings.getAll(); // Get global settings

      const newProfiles = options.profiles.map((profile) => {
        const resolutionId = profile.resolution.id + 'p'; // e.g., '144p'
        const resolutionWidth = profile.resolution.width;
        const resolutionHeight = profile.resolution.height;

        // Retrieve settings for the current resolution
        const isEnabled = settings.get(`resolution_${resolutionId}_enabled`) as boolean;
        const videoCodec = settings.get(`resolution_${resolutionId}_codec`) as string;
        const inputParams = settings.get(`resolution_${resolutionId}_input_params`) as string;
        const codecParams = settings.get(`resolution_${resolutionId}_codec_params`) as string;
        let outputFilters = settings.get(`resolution_${resolutionId}_output_filters`) as string;

        if (!isEnabled) {
          this.logger.info(`Resolution ${resolutionId} disabled, skipping.`);
          return null; // Skip this profile
        }

        // Replace placeholders in output filters
        if (outputFilters) {
          outputFilters = outputFilters.replace(/%w/g, resolutionWidth.toString()).replace(/%h/g, resolutionHeight.toString());
        }

        // Construct FFmpeg arguments
        let finalArguments = '';

        if (config.transcode_threads > 0) {
          finalArguments += `-threads ${config.transcode_threads} `;
        }

        finalArguments += `${inputParams} -c:v ${videoCodec} ${codecParams} ${outputFilters} -c:a ${config.audio_codec} ${config.audio_params}`;

        this.logger.info(
          `Generated arguments for ${resolutionId}: ${finalArguments}`
        );

        return {
          ...profile,
          ffmpegProfile: {
            ...profile.ffmpegProfile,
            arguments: finalArguments.trim() // Trim to remove leading/trailing spaces
          }
        };
      }).filter(Boolean); // Filter out null profiles (disabled resolutions)

      // Ensure that PeerTube expects an array of profiles, not nulls
      return {
        ...options,
        profiles: newProfiles
      };
    }
  );

  this.logger.info('Custom transcoder plugin registered.');
}

export async function unregister(this: PeerTubePlugin) {
  this.logger.info('Unregistering custom transcoder plugin...');
  this.peertubeHelpers.transcoding.removeFFmpegTranscodingHook(
    'on-video-transcoding'
  );
  this.logger.info('Custom transcoder plugin unregistered.');
}
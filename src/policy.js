export const defaults = { mode:'selected', tone:'Cercano y natural', instructions:'Responde de forma breve y clara. Mantén el contexto y pide intervención cuando no tengas la información necesaria.', words:'hola, qué tal, cuéntame', avoid:'mensajes repetitivos, respuestas demasiado largas', min:15, max:45, video:true };
export function canAssist(config, fan) { return config.mode === 'all' || (config.mode === 'selected' && fan.on === true); }
export function validateConfig(config) {
  if (!['all','selected','off'].includes(config.mode)) return 'Selecciona un modo válido.';
  if (![config.min,config.max].every(v => Number.isInteger(v) && v >= 0 && v <= 3600)) return 'Las esperas deben ser segundos enteros entre 0 y 3600.';
  if (config.max < config.min) return 'La espera máxima debe ser igual o mayor que la mínima.';
  return '';
}

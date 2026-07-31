import fs from 'fs';
import path from 'path';

const dir = path.resolve(process.cwd(), 'auth_info');
try {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('Sesión de WhatsApp limpiada exitosamente');
  } else {
    console.log('No existe la carpeta auth_info. Nada que limpiar.');
  }
} catch (error) {
  console.error('Error limpiando auth_info:', error.message || error);
  process.exit(1);
}

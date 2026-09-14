/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { tareaDeDescargas } from './src/aviso-descarga';

AppRegistry.registerComponent(appName, () => App);

/*
  La tarea que mantiene vivas las descargas con la aplicación al fondo. El
  nombre tiene que ser **exactamente** el de `ServicioDeDescargas.TAREA`: si no
  coinciden, el servicio arranca, no encuentra la tarea y se para solo.
*/
AppRegistry.registerHeadlessTask('descargas', () => tareaDeDescargas);

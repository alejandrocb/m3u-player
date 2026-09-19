/**
 * "Ver en la tele", contra una tele de mentira.
 *
 * La ficha imita la de la Samsung de la casa (UE32N5305), leída de verdad en
 * `http://<tele>:9197/dmr`. Lo que hay que dejar clavado es lo que se rompe
 * sin hacer ruido: el doble escapado de la URL, la dirección de control
 * relativa, y que un cero de la tele no se lea como un cero.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ErrorDeTele, MandoDeTele, aReloj, deReloj, leerTele, tipoDeVideo } from '../src/dlna.ts';

const FICHA_SAMSUNG = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>[TV] Samsung 5 Series (32)</friendlyName>
    <modelName>UE32N5305</modelName>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
        <controlURL>/upnp/control/RenderingControl1</controlURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType>
        <controlURL>/upnp/control/ConnectionManager1</controlURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/upnp/control/AVTransport1</controlURL>
      </service>
    </serviceList>
  </device>
</root>`;

/** Un `fetch` que apunta lo que le piden y contesta lo que se le diga. */
function teleFalsa(contestar: (url: string, cuerpo: string) => { estado?: number; texto: string }) {
  const pedidas: Array<{ url: string; accion: string | null; cuerpo: string }> = [];
  const pedir = (async (url: string, opciones?: { headers?: Record<string, string>; body?: string }) => {
    const cuerpo = opciones?.body ?? '';
    pedidas.push({ url, accion: opciones?.headers?.SOAPACTION ?? null, cuerpo });
    const { estado = 200, texto } = contestar(url, cuerpo);
    return { ok: estado < 400, status: estado, text: async () => texto };
  }) as unknown as typeof globalThis.fetch;
  return { pedir, pedidas };
}

test('de la ficha de la Samsung sale su nombre y dónde mandarle las órdenes', async () => {
  const { pedir } = teleFalsa(() => ({ texto: FICHA_SAMSUNG }));

  const tele = await leerTele('http://192.168.0.51:9197/dmr', pedir);

  assert.deepEqual(tele, {
    nombre: '[TV] Samsung 5 Series (32)',
    modelo: 'UE32N5305',
    ficha: 'http://192.168.0.51:9197/dmr',
    // La dirección viene relativa: hay que pegarle el servidor de la ficha.
    control: 'http://192.168.0.51:9197/upnp/control/AVTransport1',
  });
});

test('lo que no sabe reproducir no es una tele, aunque conteste', async () => {
  // Un router o una impresora también contestan, pero sin AVTransport.
  const router = FICHA_SAMSUNG.replace(/<service>\s*<serviceType>urn:schemas-upnp-org:service:AVTransport[\s\S]*?<\/service>/, '');
  const { pedir } = teleFalsa(() => ({ texto: router }));

  assert.equal(await leerTele('http://192.168.0.1:1900/ficha.xml', pedir), null);
});

test('la URL del vídeo va escapada dos veces, que la ficha viaja dentro del sobre', async () => {
  const { pedir, pedidas } = teleFalsa(() => ({ texto: '<ok/>' }));
  const mando = new MandoDeTele(
    { nombre: 'Tele', modelo: null, ficha: 'http://tele/dmr', control: 'http://tele/avt' },
    pedir,
  );

  await mando.poner('http://panel:8080/live/u/p/1.ts?token=a&b=c', 'Tom & Jerry');

  const cuerpo = pedidas[0]!.cuerpo;
  assert.match(pedidas[0]!.accion!, /#SetAVTransportURI"$/);
  // En CurrentURI, una vez.
  assert.match(cuerpo, /<CurrentURI>http:\/\/panel:8080\/live\/u\/p\/1\.ts\?token=a&amp;b=c<\/CurrentURI>/);
  // Dentro de la ficha, dos: el & de la URL acaba como &amp;amp;.
  assert.match(cuerpo, /token=a&amp;amp;b=c/);
  assert.match(cuerpo, /Tom &amp;amp; Jerry/);
  // Y se le dice qué le llega: sin esto, la Samsung rechaza la orden. Un
  // directo no se puede saltar, y se le dice.
  assert.match(cuerpo, /http-get:\*:video\/vnd\.dlna\.mpeg-tts:DLNA\.ORG_OP=00;/);
});

test('de una película se le dice a la tele que puede saltar', async () => {
  // Sin la marca, la Samsung reproducía pero rechazaba cualquier salto.
  const { pedir, pedidas } = teleFalsa(() => ({ texto: '<ok/>' }));
  const mando = new MandoDeTele({ nombre: 'T', modelo: null, ficha: 'f', control: 'http://tele/avt' }, pedir);

  await mando.poner('http://telefono:4000/v/abc.mkv', 'Película');

  assert.match(pedidas[0]!.cuerpo, /http-get:\*:video\/x-mkv:DLNA\.ORG_OP=01;DLNA\.ORG_CI=0;DLNA\.ORG_FLAGS=017/);
});

test('saltar se pide en horas, minutos y segundos', async () => {
  const { pedir, pedidas } = teleFalsa(() => ({ texto: '<ok/>' }));
  const mando = new MandoDeTele({ nombre: 'T', modelo: null, ficha: 'f', control: 'http://tele/avt' }, pedir);

  await mando.saltarA(3725.8);

  assert.match(pedidas[0]!.cuerpo, /<Unit>REL_TIME<\/Unit><Target>1:02:05<\/Target>/);
});

test('la situación se lee de las dos respuestas, y un cero al arrancar no es un cero', async () => {
  const { pedir } = teleFalsa((_url, cuerpo) =>
    cuerpo.includes('GetTransportInfo')
      ? { texto: '<s:Envelope><s:Body><u:GetTransportInfoResponse><CurrentTransportState>TRANSITIONING</CurrentTransportState></u:GetTransportInfoResponse></s:Body></s:Envelope>' }
      : { texto: '<s:Envelope><s:Body><u:GetPositionInfoResponse><TrackDuration>0:00:00</TrackDuration><RelTime>NOT_IMPLEMENTED</RelTime></u:GetPositionInfoResponse></s:Body></s:Envelope>' },
  );
  const mando = new MandoDeTele({ nombre: 'T', modelo: null, ficha: 'f', control: 'http://tele/avt' }, pedir);

  assert.deepEqual(await mando.situacion(), { estado: 'TRANSITIONING', posicion: null, duracion: null });
});

test('y cuando ya suena, dice por dónde va', async () => {
  const { pedir } = teleFalsa((_url, cuerpo) =>
    cuerpo.includes('GetTransportInfo')
      ? { texto: '<CurrentTransportState>PLAYING</CurrentTransportState>' }
      : { texto: '<TrackDuration>1:45:20</TrackDuration><RelTime>0:12:03</RelTime>' },
  );
  const mando = new MandoDeTele({ nombre: 'T', modelo: null, ficha: 'f', control: 'http://tele/avt' }, pedir);

  assert.deepEqual(await mando.situacion(), { estado: 'PLAYING', posicion: 723, duracion: 6320 });
});

test('si la tele no puede abrir el vídeo, se dice en palabras y con su código', async () => {
  // Es lo que contestó la Samsung de verdad cuando el operador bloqueaba el panel.
  const { pedir } = teleFalsa(() => ({
    estado: 500,
    texto: '<s:Fault><detail><UPnPError><errorCode>716</errorCode><errorDescription>Resource not found</errorDescription></UPnPError></detail></s:Fault>',
  }));
  const mando = new MandoDeTele({ nombre: 'T', modelo: null, ficha: 'f', control: 'http://tele/avt' }, pedir);

  const fallo = await mando.poner('http://panel/movie/u/p/1.mkv', 'Prueba').catch((error: unknown) => error);

  assert.ok(fallo instanceof ErrorDeTele);
  assert.equal(fallo.codigo, 716);
  assert.match(fallo.message, /no pudo abrir el vídeo/);
});

test('el tipo de vídeo sale de la extensión, sin mirar lo que venga detrás', () => {
  assert.equal(tipoDeVideo('http://p/movie/u/p/1.mkv'), 'video/x-mkv');
  assert.equal(tipoDeVideo('http://p/movie/u/p/1.MP4'), 'video/mp4');
  assert.equal(tipoDeVideo('http://p/live/u/p/1.ts?x=1'), 'video/vnd.dlna.mpeg-tts');
  assert.equal(tipoDeVideo('http://p/movie/u/p/1.avi'), 'video/x-msvideo');
});

test('el reloj de DLNA, en los dos sentidos', () => {
  assert.equal(aReloj(0), '0:00:00');
  assert.equal(aReloj(59.9), '0:00:59');
  assert.equal(aReloj(3600 * 2 + 61), '2:01:01');
  assert.equal(deReloj('0:12:03'), 723);
  assert.equal(deReloj('01:02:03.500'), 3723);
  assert.equal(deReloj('NOT_IMPLEMENTED'), null);
  assert.equal(deReloj(null), null);
});

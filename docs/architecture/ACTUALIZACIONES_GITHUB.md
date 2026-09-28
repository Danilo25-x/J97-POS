# Actualizaciones de J97 POS

## Objetivo
J97 usa `electron-updater` con GitHub Releases como canal de actualizaciones para Windows NSIS.

## Importante
La versión `v2.0.0` existente fue construida antes de integrar el actualizador. Por eso no debe considerarse el primer cliente autoactualizable. La primera versión que contiene esta funcionalidad será `v2.0.1`; después se probará una actualización real `v2.0.1 -> v2.0.2`.

## Datos que no forman parte de la actualización
La actualización reemplaza los archivos de la aplicación instalados por electron-builder. La base local está en `app.getPath("userData")` y las imágenes se administran mediante el servicio de medios; no se incluyen `pos-ropa.db`, `product-images` ni `backups` en Git ni en el paquete fuente.

## Dependencia
Desde el proyecto ejecutar:

```bat
npm install electron-updater@6.6.2 --save
```

Esto actualiza también `package-lock.json`. Después deben ejecutarse:

```bat
npm test
npm run build
```

## Publicación
Para una release real:

```bat
npm run release:win
```

El comando ejecuta las pruebas y publica los artefactos en GitHub usando `GH_TOKEN`. Nunca guardar `GH_TOKEN` en el repositorio.

## Flujo de prueba
1. Publicar `v2.0.1`.
2. Instalar `v2.0.1` en un entorno de prueba.
3. Crear datos: producto, variante, imagen, cliente y venta.
4. Publicar `v2.0.2`.
5. Abrir `v2.0.1`; debe detectar `v2.0.2`.
6. Descargar e instalar.
7. Comprobar que todos los datos locales siguen presentes.

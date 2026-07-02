# Portfolio admin

## Запуск

```bash
node scripts/admin-server.js
```

После запуска открыть:

```text
http://127.0.0.1:4178/index.html
```

В этом режиме админка:

- сохраняет загруженные изображения в `uploads/<project>/`;
- конвертирует изображения и GIF в WebP;
- обновляет манифест размеров;
- по кнопке «Опубликовать» создаёт commit и делает push в текущую ветку GitHub.

При открытии через `file://` интерфейс продолжает работать, но загрузки сохраняются в локальный черновик, а публикация скачивает файл `portfolio-published.js`.

## Обновление манифеста

После ручного добавления файлов в папки проекта выполнить:

```bash
node scripts/build-asset-manifest.js
```

## Оптимизация старых GIF

```bash
node scripts/optimize-existing-media.js
```

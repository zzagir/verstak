'use strict';

/* Настройки сайта. После изменения siteUrl запустите `node build.js`, чтобы обновить canonical-ссылки и sitemap.xml. */
const SITE_CONFIG = {
  name: 'Верстак',
  nameEn: 'Verstak',
  /** Адрес сайта без слеша в конце — для canonical, hreflang и sitemap.xml. */
  siteUrl: 'https://zzagir.github.io/verstak',
  /** Счётчик Яндекс.Метрики, например '12345678'. Пусто — не подключается. */
  yandexMetrikaId: '',
  /** Google Analytics 4, например 'G-XXXXXXXXXX'. Пусто — не подключается. */
  googleAnalyticsId: '',
  /** Коды рекламных блоков (РСЯ, AdSense и т. п.) — HTML как его выдаёт рекламная сеть. Пусто — блок скрыт. */
  ads: {
    top: '',     // над инструментом
    bottom: '',  // под инструментом, перед описанием
    home: '',    // на главной после первого раздела
  },
  /** E-mail для страницы «О сервисе». */
  contactEmail: 'hello@verstak.example',
};
if (typeof module !== 'undefined') module.exports = SITE_CONFIG;

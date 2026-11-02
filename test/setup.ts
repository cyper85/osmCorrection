import { setLanguage } from '../src/i18n.js';

// the tests check the German texts; Node's navigator.language would choose English
setLanguage('de', false);

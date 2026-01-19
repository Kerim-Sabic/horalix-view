/**
 * i18n Configuration
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      common: {
        loading: 'Loading...',
        error: 'An error occurred',
        save: 'Save',
        cancel: 'Cancel',
        delete: 'Delete',
        edit: 'Edit',
        view: 'View',
        search: 'Search',
        filter: 'Filter',
        export: 'Export',
      },
      nav: {
        dashboard: 'Dashboard',
        studies: 'Studies',
        patients: 'Patients',
        aiModels: 'AI Models',
        settings: 'Settings',
        admin: 'Administration',
      },
      viewer: {
        tools: {
          pan: 'Pan',
          zoom: 'Zoom',
          windowLevel: 'Window/Level',
          measure: 'Measure',
          rotate: 'Rotate',
        },
      },
    },
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;

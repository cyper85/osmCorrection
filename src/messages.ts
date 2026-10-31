import type { ValidationResult } from 'osmvalidation';

/** German texts for the exact English messages of osmValidation. */
const BY_MESSAGE: Record<string, string> = {
  'Phone number has leading or trailing whitespace': 'Telefonnummer hat Leerzeichen am Anfang oder Ende',
  'Phone number must not start with "tel:"': 'Telefonnummer darf nicht mit „tel:“ beginnen',
  'Phone number is a valid emergency number': 'Gültige Notrufnummer',
  'Phone number contains invalid characters': 'Telefonnummer enthält unzulässige Zeichen',
  'Phone number is not a valid international number': 'Keine gültige internationale Telefonnummer',
  'International phone number must not contain "(0)"': 'Internationale Telefonnummer darf kein „(0)“ enthalten',
  'Phone number is a valid international number': 'Gültige internationale Telefonnummer',
  'Use "+" instead of "00" before the country code': 'Vor der Ländervorwahl „+“ statt „00“ verwenden',
  'Phone number is not in international format (+<country code> <number>)':
    'Telefonnummer ist nicht im internationalen Format (+<Ländervorwahl> <Nummer>)',

  'E-mail address has leading or trailing whitespace': 'E-Mail-Adresse hat Leerzeichen am Anfang oder Ende',
  'E-mail address must not start with "mailto:"': 'E-Mail-Adresse darf nicht mit „mailto:“ beginnen',
  'E-mail address is invalid': 'Ungültige E-Mail-Adresse',
  'Domain of the e-mail address is invalid': 'Die Domain der E-Mail-Adresse ist ungültig',
  'E-mail address with a local domain is not useful': 'E-Mail-Adresse mit lokaler Domain ist nicht sinnvoll',
  'E-mail address is valid': 'Gültige E-Mail-Adresse',

  'URL has leading or trailing whitespace': 'URL hat Leerzeichen am Anfang oder Ende',
  'Only http and https URLs are allowed': 'Nur http- und https-URLs sind erlaubt',
  'URL has no protocol': 'URL ohne Protokoll (https://)',
  'URL contains whitespace': 'URL enthält Leerzeichen',
  'URL cannot be parsed': 'URL ist nicht lesbar',
  'URL to a local service is not useful': 'URL zu einem lokalen Dienst ist nicht sinnvoll',
  'Host is neither an IP address nor a fully qualified domain name': 'Host ist weder eine IP-Adresse noch ein vollständiger Domainname',
  'URL is valid': 'Gültige URL',

  'Valid Facebook username': 'Gültiger Facebook-Name',
  'Neither a Facebook username nor a link to a Facebook page': 'Weder ein Facebook-Name noch ein Link auf eine Facebook-Seite',
  'URL does not point to a Facebook page': 'URL zeigt nicht auf eine Facebook-Seite',
  'Facebook URL contains parameters': 'Facebook-URL enthält Parameter',
  'Valid Facebook URL': 'Gültige Facebook-URL',

  'Valid X/Twitter username': 'Gültiger X/Twitter-Name',
  'Neither an X/Twitter username nor a link to an X/Twitter profile': 'Weder ein X/Twitter-Name noch ein Link auf ein X/Twitter-Profil',
  'URL does not point to an X/Twitter profile': 'URL zeigt nicht auf ein X/Twitter-Profil',
  'X/Twitter URL contains parameters': 'X/Twitter-URL enthält Parameter',
  'Valid X/Twitter URL': 'Gültige X/Twitter-URL',

  'Use the format "language:Title" instead of a URL': 'Format „Sprache:Titel“ statt einer URL verwenden',
  'Value must start with a language code, e.g. "en:Title"': 'Wert muss mit einem Sprachcode beginnen, z. B. „de:Titel“',
  'Title must not be URL-encoded': 'Titel darf nicht URL-kodiert sein',
  'Valid Wikipedia article': 'Gültiger Wikipedia-Artikel',
  'Title is missing': 'Titel fehlt',
  'Title contains characters that are not allowed: # < > [ ] | { } ~~~': 'Titel enthält unzulässige Zeichen: # < > [ ] | { } ~~~',
  'Title must refer to an article, not to another namespace': 'Titel muss auf einen Artikel zeigen, nicht auf einen anderen Namensraum',
  'Title must not contain relative path segments': 'Titel darf keine relativen Pfadangaben enthalten',

  'Valid Wikidata ID': 'Gültige Wikidata-ID',
  'Use the plain ID instead of a URL': 'Nur die ID statt einer URL verwenden',
  'Wikidata ID must be an upper case "Q" followed by digits': 'Wikidata-ID besteht aus einem großen „Q“ und Ziffern',
  'Not a Wikidata ID like "Q64"': 'Keine Wikidata-ID wie „Q64“',
};

/** Fallback if osmValidation changes a message: a German text per code. */
const BY_CODE: Record<string, string> = {
  PHONE_VALID: 'Gültige Telefonnummer',
  PHONE_EMERGENCY: 'Gültige Notrufnummer',
  PHONE_INVALID: 'Ungültige Telefonnummer',
  PHONE_NOT_INTERNATIONAL: 'Telefonnummer ist nicht im internationalen Format',
  PHONE_IDD_PREFIX: 'Vor der Ländervorwahl „+“ statt „00“ verwenden',
  PHONE_TRUNK_PREFIX: 'Internationale Telefonnummer darf kein „(0)“ enthalten',
  PHONE_TEL_PREFIX: 'Telefonnummer darf nicht mit „tel:“ beginnen',
  PHONE_WHITESPACE: 'Telefonnummer hat Leerzeichen am Anfang oder Ende',
  MAIL_VALID: 'Gültige E-Mail-Adresse',
  MAIL_INVALID: 'Ungültige E-Mail-Adresse',
  MAIL_DOMAIN_INVALID: 'Die Domain der E-Mail-Adresse ist ungültig',
  MAIL_LOCAL_ADDRESS: 'E-Mail-Adresse mit lokaler Domain ist nicht sinnvoll',
  MAIL_MAILTO: 'E-Mail-Adresse darf nicht mit „mailto:“ beginnen',
  MAIL_WHITESPACE: 'E-Mail-Adresse hat Leerzeichen am Anfang oder Ende',
  URL_VALID: 'Gültige URL',
  URL_INVALID: 'Ungültige URL',
  URL_PROTOCOL_INVALID: 'Nur http- und https-URLs sind erlaubt',
  URL_PROTOCOL_MISSING: 'URL ohne Protokoll (https://)',
  URL_LOCAL_ADDRESS: 'URL zu einem lokalen Dienst ist nicht sinnvoll',
  URL_HOST_INVALID: 'Ungültiger Host',
  URL_WHITESPACE: 'URL hat Leerzeichen am Anfang oder Ende',
  FACEBOOK_USERNAME: 'Gültiger Facebook-Name',
  FACEBOOK_URL: 'Gültige Facebook-URL',
  FACEBOOK_URL_PARAMETERS: 'Facebook-URL enthält Parameter',
  FACEBOOK_INVALID: 'Ungültige Facebook-Angabe',
  TWITTER_USERNAME: 'Gültiger X/Twitter-Name',
  TWITTER_URL: 'Gültige X/Twitter-URL',
  TWITTER_URL_PARAMETERS: 'X/Twitter-URL enthält Parameter',
  TWITTER_INVALID: 'Ungültige X/Twitter-Angabe',
  WIKIPEDIA_VALID: 'Gültiger Wikipedia-Artikel',
  WIKIPEDIA_URL: 'Format „Sprache:Titel“ statt einer URL verwenden',
  WIKIPEDIA_ENCODED: 'Titel darf nicht URL-kodiert sein',
  WIKIPEDIA_LANGUAGE_MISSING: 'Wert muss mit einem Sprachcode beginnen, z. B. „de:Titel“',
  WIKIPEDIA_INVALID: 'Ungültiger Wikipedia-Titel',
  WIKIDATA_VALID: 'Gültige Wikidata-ID',
  WIKIDATA_URL: 'Nur die ID statt einer URL verwenden',
  WIKIDATA_FORMAT: 'Wikidata-ID besteht aus einem großen „Q“ und Ziffern',
  WIKIDATA_INVALID: 'Keine Wikidata-ID wie „Q64“',
};

/** German message for a validation result; the English original if unknown. */
export function germanMessage(result: Pick<ValidationResult, 'code' | 'message'>): string {
  return BY_MESSAGE[result.message] ?? BY_CODE[result.code] ?? result.message;
}

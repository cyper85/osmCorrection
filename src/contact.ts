/*
 * The e-mail address on the Impressum is not in the HTML, so crawlers that
 * collect addresses from page source do not find it. The page holds the parts
 * reversed in data attributes; this script puts the address together. Without
 * JavaScript the page shows it written out ("webmaster (at) …").
 */

const reverse = (text: string) => [...text].reverse().join('');

for (const element of document.querySelectorAll<HTMLElement>('[data-mail-user][data-mail-host]')) {
  const address = `${reverse(element.dataset.mailUser ?? '')}@${reverse(element.dataset.mailHost ?? '')}`;
  const link = document.createElement('a');
  link.href = `mailto:${address}`;
  link.textContent = address;
  element.replaceChildren(link);
}

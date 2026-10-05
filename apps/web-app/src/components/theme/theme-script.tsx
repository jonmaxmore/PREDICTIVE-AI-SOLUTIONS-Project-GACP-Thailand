export function ThemeScript() {
  const script = `
    (function () {
      try {
        var stored = localStorage.getItem('theme');
        var hasExplicitPreference = localStorage.getItem('theme:explicit') === '1';
        var resolved = hasExplicitPreference && (stored === 'light' || stored === 'dark')
          ? stored
          : 'light';
        if (!hasExplicitPreference) {
          localStorage.setItem('theme', resolved);
        }
        var dark = resolved === 'dark';
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.setAttribute('data-color-scheme', dark ? 'dark' : 'light');
      } catch (error) {
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-color-scheme', 'light');
      }
    })();
  `;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

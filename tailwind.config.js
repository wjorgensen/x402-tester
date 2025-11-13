/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dark theme color palette
        dark: {
          bg: '#0a0a0a',
          surface: '#1a1a1a',
          surfaceHover: '#252525',
          border: '#2a2a2a',
          text: {
            primary: '#f5f5f5',
            secondary: '#a3a3a3',
            muted: '#737373',
          },
          accent: {
            blue: '#3b82f6',
            blueHover: '#2563eb',
            green: '#10b981',
            greenHover: '#059669',
            purple: '#8b5cf6',
            purpleHover: '#7c3aed',
          },
        },
      },
    },
  },
  plugins: [],
};

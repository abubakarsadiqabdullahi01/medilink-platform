import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';
import defaultTheme from 'tailwindcss/defaultTheme';

export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
  	container: {
  		center: true,
  		padding: '1.5rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	extend: {
  		fontFamily: {
  			// Plus Jakarta Sans, self-hosted (src/app/fonts), then the system stack so text
  			// is readable at once and never waits on the file.
  			sans: ['var(--font-sans)', ...defaultTheme.fontFamily.sans]
  		},
  		colors: {
  			// The public pages' own surfaces (see globals.css). `bg-brand-night/90` works.
  			brand: {
  				night: 'hsl(var(--brand-night))',
  				deeper: 'hsl(var(--brand-deeper))',
  				mint: 'hsl(var(--brand-mint))'
  			},
  			tint: 'hsl(var(--surface-tint))',
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))',
  				text: 'hsl(var(--destructive-text))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				foreground: 'hsl(var(--success-foreground))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
  				foreground: 'hsl(var(--warning-foreground))'
  			},
  			info: {
  				DEFAULT: 'hsl(var(--info))',
  				foreground: 'hsl(var(--info-foreground))'
  			},
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		// Secondary text was 12px and content 14px, too small for the pilot's readers
  		// (UXA-01). Content is now 16px, the floor the blueprint asks for, and secondary text
  		// 14px, with nothing set below that. Everything else is sized in rem, so the larger-text
  		// switch still scales from here.
  		//
  		// The named scale below is what headings use, so two pages cannot disagree
  		// about how big a page title is. Body is `text-sm` (1rem) and secondary is
  		// `text-xs` (0.875rem) — their names are shadcn's, their sizes are ours.
  		//   display  the hero of a public page
  		//   h1       a page title        h2  a section        h3  a card or group
  		//   body / small   running text and secondary text, as above
  		// Spacing is Tailwind's 4px scale: 1–3 inside a control, 4 between related
  		// things, 6 between groups, 8–12 between sections.
  		fontSize: {
  			xs: ['0.875rem', { lineHeight: '1.3rem' }],
  			sm: ['1rem', { lineHeight: '1.5rem' }],
  			display: ['clamp(2.25rem, 1.6rem + 2.4vw, 3.75rem)', { lineHeight: '1.08', letterSpacing: '-0.02em', fontWeight: '600' }],
  			h1: ['1.75rem', { lineHeight: '2.25rem', letterSpacing: '-0.015em', fontWeight: '600' }],
  			h2: ['1.375rem', { lineHeight: '1.875rem', letterSpacing: '-0.01em', fontWeight: '600' }],
  			h3: ['1.125rem', { lineHeight: '1.625rem', fontWeight: '600' }],
  			body: ['1rem', { lineHeight: '1.5rem' }],
  			small: ['0.875rem', { lineHeight: '1.3rem' }]
  		},
  		boxShadow: {
  			card: 'var(--shadow-card)',
  			raised: 'var(--shadow-raised)'
  		},
  		transitionDuration: {
  			fast: 'var(--duration-fast)',
  			base: 'var(--duration-base)',
  			slow: 'var(--duration-slow)'
  		},
  		transitionTimingFunction: {
  			out: 'var(--ease-out)'
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
  			shimmer: {
  				'100%': {
  					transform: 'translateX(100%)'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			shimmer: 'shimmer 1.6s infinite'
  		}
  	}
  },
  plugins: [animate],
} satisfies Config;

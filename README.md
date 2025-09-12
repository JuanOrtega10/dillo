# Dillo

Your AI-native companion for English classes — focused on pronunciation.

## About

Dillo is an English learning app designed to help students improve their pronunciation through AI-powered analysis. The app features a charming armadillo mascot and provides targeted alternatives, IPA transcriptions, and practice scores based on class transcripts.

## How to Use

1. **Welcome Screen**: Start at the hero page featuring the Dillo mascot and app introduction
2. **Get Started**: Click the "Get started" button to transition to the analysis interface
3. **Analysis View**: 
   - Paste your class transcript in the provided textarea
   - Optionally add learning objectives
   - Use the "Show transcript format help" link to see the expected format
   - The Analyze button will process your input (functionality coming soon)
   - Use Reset to return to the welcome screen

## Transcript Format

The app expects transcripts in this format:

\`\`\`
Private Class: Juan Ortega - Transcript
00:00:00

Simon Sanchez: It worked, right?
Juan Alberto Ortega Riveros: Yeah. Yeah. Private.
Simon Sanchez: After the meeting it should show up in the same folder I gave you access to.
Juan Alberto Ortega Riveros: Yeah.

00:01:00

Simon Sanchez: Try to choose classes that are one-on-one; it's easier to parse.
Juan Alberto Ortega Riveros: Mhm.
Simon Sanchez: You've seen the format, right?
Juan Alberto Ortega Riveros: Yeah. I saw it yesterday.
\`\`\`

## Development

This is a Next.js app built with:
- Next.js App Router
- TypeScript
- Tailwind CSS
- Custom fonts (Rye for branding, Outfit for UI)

APIs and database functionality will be added in future updates.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) to view the app.

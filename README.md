# Dillo - English Learner Companion

Your AI-native companion for English classes — focused on pronunciation practice and improvement.

## About

Dillo is an intelligent English learning app designed to help students improve their pronunciation through AI-powered analysis and practice. The app features a charming armadillo mascot and provides:

- **Smart Transcript Analysis**: Automatically processes class transcripts to identify learning opportunities
- **Pronunciation Alternatives**: AI-generated alternative phrases for better pronunciation practice  
- **IPA Transcriptions**: International Phonetic Alphabet notations for accurate pronunciation guidance
- **Speech Scoring**: Real-time pronunciation assessment with detailed feedback
- **Interactive Practice Mode**: Focused quiz interface for targeted pronunciation practice
- **Vocabulary Extraction**: Automatic identification of key vocabulary from transcripts

## Features

### 🎯 Transcript Analysis
- Paste class transcripts and get AI-powered analysis
- Automatic sentence and vocabulary extraction
- Learning objectives integration
- Progress tracking with visual indicators

### 🗣️ Speech Practice
- Record pronunciation attempts (up to 10 seconds)
- AI-powered scoring with detailed breakdowns
- Phoneme-level analysis and feedback
- Practice mode with navigation between items

### 📚 Learning Tools
- Tabbed interface for sentences and vocabulary
- Favorites system for important items
- Copy-to-clipboard functionality
- IPA transcription display

### 🎨 User Experience
- Responsive design for all devices
- Accessible interface with keyboard shortcuts
- Smooth animations and transitions

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- OpenAI API key
- Language Confidence API key (for speech scoring)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/JuanOrtega10/dillo.git
   cd dillo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Fill in your API keys in `.env.local` (see Environment Variables section below)

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open the app**
   Navigate to [http://localhost:3000](http://localhost:3000) in your browser

### Build for Production

```bash
npm run build
npm start
```

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```env
# OpenAI API Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Language Confidence API Configuration  
LC_API_KEY=your_language_confidence_api_key_here
LANGUAGE_CONFIDENCE_API_KEY=your_language_confidence_api_key_here
```

### Getting API Keys

1. **OpenAI API Key**: 
   - Visit [OpenAI Platform](https://platform.openai.com/)
   - Create an account and generate an API key
   - Used for transcript analysis and generating pronunciation alternatives

2. **Language Confidence API Key**:
   - Visit [Language Confidence](https://www.languageconfidence.ai/)
   - Sign up for an account and get your API key
   - Used for speech pronunciation scoring

## Usage

### 1. Welcome Screen
- Start at the hero page featuring the Dillo mascot
- Click "Get started" to begin using the app

### 2. Transcript Analysis
- Paste your class transcript in the textarea
- Optionally add learning objectives
- Click "Analyze" to process the transcript
- View results in the Sentences and Vocabulary tabs

### 3. Practice Mode
- Click on any sentence alternative or vocabulary word
- Use the practice modal to record your pronunciation
- Get instant AI-powered scoring and feedback
- Navigate between items with Previous/Next buttons

### 4. Managing Favorites
- Click the heart icon to favorite important items
- Access favorites across both main view and practice mode
- Favorites are preserved during your session

## Transcript Format

The app expects transcripts in this format:

```
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
```

## Technology Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **UI Components**: Custom components with shadcn/ui patterns
- **Fonts**: Rye (branding), Outfit (UI text)
- **APIs**: OpenAI GPT-4, Language Confidence API
- **Audio**: Web Audio API for recording

## API Endpoints

- `POST /api/analyze-window` - Analyzes transcript windows for learning content
- `POST /api/speech-score` - Scores pronunciation attempts

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, please open an issue on GitHub or contact the development team.

---

Made with ❤️ for English learners everywhere

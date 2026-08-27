const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Initialize Gemini
// Set your API key as an environment variable: GEMINI_API_KEY
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

app.post('/chat', async (req, res) => {
    const { history = [], systemPrompt, boot } = req.body;

    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash',
            systemInstruction: systemPrompt
        });

        // If booting, send an empty first message to get the AI's greeting
        const chatHistory = history.map(h => ({
            role: h.role,
            parts: [{ text: h.content }]
        }));

        const chat = model.startChat({ history: chatHistory });

        const userMessage = boot
            ? 'Start the onboarding. Greet the pharmacist warmly and ask which PMS software they use. List the options as bullet points.'
            : history[history.length - 1]?.content || '';

        const result = await chat.sendMessage(userMessage);
        const reply = result.response.text();

        res.json({ reply });

    } catch (err) {
        console.error('[PST Chat Error]', err.message);
        res.status(500).json({ reply: "I'm having trouble right now. Please try again in a moment." });
    }
});

app.listen(PORT, () => {
    console.log(`[PST] AI Chat Server running on http://localhost:${PORT}`);
    console.log(`[PST] Make sure GEMINI_API_KEY environment variable is set.`);
});

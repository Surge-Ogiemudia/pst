const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

module.exports = async (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { history = [], systemPrompt, boot } = req.body;

    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash',
            systemInstruction: systemPrompt
        });

        // The last item in history is the user's current message, which we send via chat.sendMessage()
        // Gemini requires strict alternating history, so we must exclude it from startChat's history
        const previousHistory = history.slice(0, -1);
        
        // Map history to Gemini format
        const chatHistory = previousHistory.map(h => ({
            role: h.role === 'assistant' ? 'model' : h.role,
            parts: [{ text: h.content }]
        }));

        const chat = model.startChat({ history: chatHistory });

        const userMessage = boot
            ? 'Start the onboarding. Greet the pharmacist warmly and ask which PMS software they use. List the options as bullet points prefixed with •'
            : (history[history.length - 1]?.content || '');

        const result = await chat.sendMessage(userMessage);
        const reply = result.response.text();

        return res.status(200).json({ reply });

    } catch (err) {
        console.error('[PST Chat Error]', err.message);
        return res.status(500).json({
            reply: "I'm having trouble right now. Please try again in a moment."
        });
    }
};

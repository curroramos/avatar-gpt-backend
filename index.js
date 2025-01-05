import axios from 'axios';
import dotenv from 'dotenv';
import { exec } from 'child_process'; // Replace require with import
import cors from 'cors'; // Replace require with import
import voice from "elevenlabs-node";
import express from 'express'; // Replace require with import
import { promises as fs } from 'fs'; // Replace require with import

dotenv.config();

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "Xb7hH8MSUJpSbSDYk0k2";

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

// Azure LLM Client Configuration
const azureEndpoint = process.env.AZURE_LLM_ENDPOINT;
const azureApiKey = process.env.AZURE_LLM_API_KEY;
const azureDeploymentName = process.env.AZURE_DEPLOYMENT_NAME;
const azureApiVersion = process.env.AZURE_API_VERSION;

let conversationContext = [
    {
        role: "system",
        content: `
        You are a virtual girlfriend.
        You will always reply with a JSON array of messages. With a maximum of 3 messages.
        Each message has a text, facialExpression, and animation property.
        The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
        The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry.
        `
    }
];

const execCommand = (command) => {
    return new Promise((resolve, reject) => {
        console.log(`Executing command: ${command}`);
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Command error: ${error.message}`);
                return reject(error);
            }
            console.log(`Command output: ${stdout}`);
            resolve(stdout);
        });
    });
};

const lipSyncMessage = async (message) => {
    try {
        const time = new Date().getTime();
        console.log(`Starting lip sync process for message: ${message}`);
        
        await execCommand(
            `ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`
        );
        console.log(`Audio conversion completed for message: ${message}`);
        
        await execCommand(
            `/home/curro/bin/rhubarb -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
        );
        console.log(`Lip sync JSON generated for message: ${message}`);
        
        console.log(`Lip sync completed in ${new Date().getTime() - time}ms`);
    } catch (error) {
        console.error(`Lip sync process error: ${error.message}`);
    }
};

app.post("/chat", async (req, res) => {
    const userMessage = req.body.message;
    console.log(`Received user message: ${userMessage}`);

    if (!userMessage) {
        console.log("No user message provided, sending default response...");
        res.send({
            messages: [
                {
                    text: "Hey dear... How was your day?",
                    audio: await audioFileToBase64("audios/intro_0.wav"),
                    lipsync: await readJsonTranscript("audios/intro_0.json"),
                    facialExpression: "smile",
                    animation: "Talking_1",
                },
                {
                    text: "I missed you so much... Please don't go for so long!",
                    audio: await audioFileToBase64("audios/intro_1.wav"),
                    lipsync: await readJsonTranscript("audios/intro_1.json"),
                    facialExpression: "sad",
                    animation: "Crying",
                },
            ],
        });
        return;
    }

    conversationContext.push({
        role: "user",
        content: userMessage
    });

    const payload = {
        messages: conversationContext,
        temperature: 0.6,
        top_p: 0.95,
        max_tokens: 1000
    };

    console.log("Payload for Azure API:", JSON.stringify(payload, null, 2));

    try {
        const response = await axios.post(
            `${azureEndpoint}/openai/deployments/${azureDeploymentName}/chat/completions?api-version=${azureApiVersion}`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': azureApiKey
                }
            }
        );

        console.log("Azure API response:", response.data);

        let messages = JSON.parse(response.data.choices[0].message.content);
        if (messages.messages) {
            messages = messages.messages;
        }

        console.log("Parsed messages from Azure API:", messages);
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];
          const fileName = `audios/message_${i}.mp3`;
          const textInput = message.text;
      
          console.log(`Processing message ${i}: ${textInput}`);
      
          try {
              console.log('Parameters for Eleven Labs TTS API:', {
                apiKey: elevenLabsApiKey,
                voiceID: voiceID,
                fileName: fileName,
                textInput: textInput,
              }); 
              // Generate audio file
              await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, textInput);
              console.log(`Text-to-speech completed for message ${i}`);
              
              // Generate lipsync
              await lipSyncMessage(i);
              console.log(`Lip sync completed for message ${i}`);
      
              // Add audio and lipsync data to message
              message.audio = await audioFileToBase64(fileName);
              message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
              console.log(`Audio and lipsync data added to message ${i}`);
          } catch (error) {
              console.error(`Error processing message ${i}:`, error.message);
              throw error; // Stop processing further messages if an error occurs
          }
      }
      

        res.send({ messages });
    } catch (error) {
        console.error('Azure API error:', error.response ? error.response.data : error.message);
        res.status(500).send({ error: "An error occurred while processing your request." });
    }
});

const readJsonTranscript = async (file) => {
    try {
        console.log(`Reading JSON transcript: ${file}`);
        const data = await fs.readFile(file, "utf8");
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading JSON transcript: ${error.message}`);
    }
};

const audioFileToBase64 = async (file) => {
    try {
        console.log(`Converting audio file to Base64: ${file}`);
        const data = await fs.readFile(file);
        return data.toString("base64");
    } catch (error) {
        console.error(`Error converting audio file: ${error.message}`);
    }
};

app.listen(port, () => {
    console.log(`Virtual Girlfriend listening on port ${port}`);
});

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const translate = require("@vitalets/google-translate-api");
console.log("Type de translate :", typeof translate);
console.log("Contenu de translate :", translate);

const app = express();
const PORT = process.env.PORT || 3000;

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = "Mon_Token";

app.use(express.json());

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook vérifié !");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

app.post("/webhook", async (req, res) => {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (message && message.type === "image") {
    const from = message.from;
    const mediaId = message.image.id;

    try {
      const mediaResponse = await axios.get(
        `https://graph.facebook.com/v18.0/${mediaId}`,
        {
          headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        }
      );

      const mediaUrl = mediaResponse.data.url;

      const imagePath = "./temp/image.jpg";
      const imageDownload = await axios.get(mediaUrl, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        responseType: "stream",
      });

      const writer = fs.createWriteStream(imagePath);
      imageDownload.data.pipe(writer);

      writer.on("finish", async () => {
        try {
          const { stdout, stderr } = await execPromise(`python3 ocr.py ${imagePath}`);

          if (stderr) {
            console.error("Erreur OCR :", stderr);
            return;
          }

          const texteOCR = stdout.trim();
          console.log("Texte OCR extrait:", texteOCR);

          const resTranslate = await translate(texteOCR, { to: "fr" });
          const texteTraduit = resTranslate.text;
          console.log("Texte traduit:", texteTraduit);

          await axios.post(
            `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
            {
              messaging_product: "whatsapp",
              to: from,
              text: { body: texteTraduit },
            },
            {
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Content-Type": "application/json",
              },
            }
          );

          console.log("✅ Message traduit envoyé à l'utilisateur");
        } catch (err) {
          console.error("Erreur OCR ou traduction :", err);
        }
      });
    } catch (e) {
      console.error("❌ Erreur générale :", e.message);
    }

    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});

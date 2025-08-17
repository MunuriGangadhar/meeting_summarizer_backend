require('dotenv').config();
const express=require('express');
const cors=require('cors');
const multer=require('multer');
const {GoogleGenerativeAI}=require('@google/generative-ai');
const nodemailer=require('nodemailer');
const validator=require('validator');
const path=require('path');
const fs=require('fs');

const app=express();
app.use(express.json());

const uploadDir=path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage=multer.diskStorage({
  destination:(req, file, cb)=>cb(null,uploadDir),
  filename:(req,file,cb)=>cb(null,`${Date.now()}-${file.originalname}`)
});

const upload=multer({
  storage,
  limits:{fileSize:5*1024*1024}, 
  fileFilter:(req,file,cb)=>{
    if(path.extname(file.originalname)!=='.txt'){
      return cb(new Error('Only .txt files are allowed'));
    }
    cb(null,true);
  }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/generate-summary', upload.single('transcript'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing or invalid transcript file (must be .txt)' });
    const transcript = fs.readFileSync(req.file.path, 'utf-8');
    const prompt = req.body.prompt?.trim();
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const fullPrompt = `Summarize the following transcript based on this instruction: ${prompt}. Transcript: ${transcript}`;
    const result = await model.generateContent(fullPrompt);
    const summary = result.response.text();

    fs.unlinkSync(req.file.path);
    res.json({ summary });
  } catch (error) {
    console.error('Summary error:', error.message);
    if (error.message.includes('Only .txt')) return res.status(400).json({ error: error.message });
    if (error.response?.status === 429) return res.status(429).json({ error: 'AI rate limit exceeded. Try later.' });
    res.status(500).json({ error: 'Failed to generate summary. Check logs.' });
  }
});

app.post('/send-email',async(req,res)=>{
  try {
    const {summary,recipients}=req.body;
    if (!summary?.trim()) return res.status(400).json({ error: 'Missing or empty summary' });
    if (!recipients?.trim()) return res.status(400).json({ error: 'Missing recipients' });

    const recipientList = recipients.split(',').map(r => r.trim()).filter(r => validator.isEmail(r));
    if (recipientList.length === 0) return res.status(400).json({ error: 'No valid email addresses provided' });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipientList.join(','),
      subject: 'Meeting Summary',
      text: summary
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('Email error:', error.message);
    if (error.code === 'EAUTH') return res.status(401).json({ error: 'Invalid email credentials' });
    res.status(500).json({ error: 'Failed to send email. Check logs.' });
  }
});

app.listen(5000, () => console.log('Server running on port 5000'));
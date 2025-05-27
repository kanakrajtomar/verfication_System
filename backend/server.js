require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pool = require('./db');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// Multer config (for image upload)
const upload = multer({ storage: multer.memoryStorage() });

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Nodemailer config
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_SENDER,
    pass: process.env.EMAIL_PASSWORD, // App password from Google
  },
});

// Email helper
async function sendEmail(to, subject, html) {
  await transporter.sendMail({
    from: `"Document Verification" <${process.env.EMAIL_SENDER}>`,
    to,
    subject,
    html,
  });
}

// Route: Submit verification
app.post('/submit-verification', upload.single('image'), async (req, res) => {
  const { email, phone } = req.body;
  if (!email || !phone || !req.file) {
    return res.status(400).json({ error: 'Email, phone, and image are required' });
  }

  try {
    const streamUpload = (buffer) => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'verification_images' },
          (error, result) => {
            if (result) resolve(result);
            else reject(error);
          }
        );
        stream.end(buffer);
      });
    };

    const uploadResult = await streamUpload(req.file.buffer);

    await pool.query(
      'INSERT INTO users_verification (email, phone, image_url) VALUES ($1, $2, $3)',
      [email, phone, uploadResult.secure_url]
    );

    res.json({ message: 'Verification request submitted successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Route: Get all verifications (admin panel)
app.get('/admin/verifications', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users_verification ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch verifications' });
  }
});

// Route: Approve or reject verification
app.post('/admin/verifications/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  try {
    await pool.query('UPDATE users_verification SET status = $1 WHERE id = $2', [action, id]);

    const { rows } = await pool.query('SELECT email FROM users_verification WHERE id = $1', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userEmail = rows[0].email;
    const subject = `Your verification has been ${action}d`;
    const html = `<p>Hello,</p><p>Your document verification request has been <strong>${action}d</strong> by the admin.</p><p>Regards,<br>Team</p>`;

    await sendEmail(userEmail, subject, html);

    res.json({ message: `Verification ${action}d and user notified.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));



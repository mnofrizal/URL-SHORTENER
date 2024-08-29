import express from "express";
import { PrismaClient } from "@prisma/client";
import { customAlphabet } from "nanoid"; // Import customAlphabet dari nanoid
import validUrl from "valid-url";
import path from "path";
import cors from "cors";
import multer from "multer";
import xlsx from "xlsx";

const upload = multer({ dest: "uploads/" }); // Tempat penyimpanan sementara file yang diunggah

const app = express();
const prisma = new PrismaClient();

// Middleware untuk parsing JSON
app.use(express.json());

// Middleware untuk mengizinkan CORS
app.use(cors());

// Middleware untuk melayani file statis
app.use(express.static(path.join(process.cwd(), "public")));

const baseUrl = "https://msdm.app/q";
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; // Alfanumerik
const nanoid = customAlphabet(alphabet, 7); // Menghasilkan ID 7 karakter dari alphabet alfanumerik

// Endpoint untuk membuat short URL
app.post("/api/url/shorten", async (req, res) => {
  const { originalUrl } = req.body;

  if (!validUrl.isUri(baseUrl)) {
    return res.status(401).json("Invalid base URL");
  }

  const urlCode = nanoid(6); // Generate 7-character long ID

  if (validUrl.isUri(originalUrl)) {
    try {
      const shortUrl = `${baseUrl}/${urlCode}`;

      const newUrl = await prisma.url.create({
        data: {
          originalUrl,
          shortUrl,
          urlCode,
        },
      });

      res.json(newUrl);
    } catch (err) {
      console.error(err);
      res.status(500).json("Server error");
    }
  } else {
    res.status(401).json("Invalid original URL");
  }
});

// Endpoint untuk redirect short URL ke original URL dan menambah jumlah klik serta mencatat riwayat klik
app.get("/:code", async (req, res) => {
  try {
    const url = await prisma.url.findUnique({
      where: { shortUrl: `${baseUrl}/${req.params.code}` }, // Menggunakan shortUrl
    });

    if (url) {
      // Tambah jumlah klik dan perbarui lastClickAt
      await prisma.url.update({
        where: { id: url.id },
        data: {
          clicks: { increment: 1 },
          lastClickAt: new Date(),
        },
      });

      // Simpan riwayat klik
      await prisma.clickHistory.create({
        data: {
          urlId: url.id,
          clickedAt: new Date(),
        },
      });

      return res.redirect(url.originalUrl);
    } else {
      return res.status(404).json("No URL found");
    }
  } catch (err) {
    console.error(err);
    res.status(500).json("Server error");
  }
});

// Endpoint untuk mendapatkan riwayat klik dari sebuah URL
app.get("/api/url/:code/history", async (req, res) => {
  try {
    const url = await prisma.url.findUnique({
      where: { urlCode: req.params.code },
      include: { clicksHistory: true }, // Mengambil data riwayat klik
    });

    if (url) {
      res.json(url.clicksHistory);
    } else {
      res.status(404).json("No URL found");
    }
  } catch (err) {
    console.error(err);
    res.status(500).json("Server error");
  }
});

// Endpoint untuk mendapatkan semua URL yang telah dibuat
app.get("/api/urls", async (req, res) => {
  try {
    const urls = await prisma.url.findMany({
      orderBy: {
        id: "asc", // Mengurutkan berdasarkan ID secara menaik
      },
    });
    res.json(urls);
  } catch (err) {
    console.error(err);
    res.status(500).json("Server error");
  }
});

app.post("/api/upload-excel", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    const bulkData = rows
      .map((row) => {
        const originalUrl = row[0]; // Assuming the first column is the original URL
        const name = row[1] || ""; // Assuming the second column is the name (optional)
        if (!originalUrl || originalUrl === "originalUrl") return null; // Skip if there's no original URL or it's the header

        const shortUrl = `${baseUrl}/${nanoid()}`; // Generate short URL code

        return {
          originalUrl,
          shortUrl,
          name, // Include the name in the data structure
        };
      })
      .filter(Boolean); // Remove any null entries

    if (bulkData.length === 0) {
      throw new Error("No valid data found in the uploaded file.");
    }

    // Save all valid URLs in bulk
    await prisma.url.createMany({
      data: bulkData,
    });

    res.status(200).json({ message: "URLs created successfully" });
  } catch (err) {
    console.error("Error processing Excel file:", err);
    res.status(500).json("Server error");
  }
});

app.get("/api/export-excel", async (req, res) => {
  try {
    const urls = await prisma.url.findMany();

    // Convert data to worksheet
    const worksheetData = urls.map((url) => ({
      ID: url.id,
      "Original URL": url.originalUrl,
      "Short URL": url.shortUrl,
      Clicks: url.clicks,
      "Created At": new Date(url.createdAt).toLocaleString(),
    }));

    const worksheet = xlsx.utils.json_to_sheet(worksheetData);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "URLs");

    // Write to a buffer
    const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });

    // Set headers for file download
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="shortened_urls.xlsx"'
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    // Send the file to the client
    res.send(buffer);
  } catch (err) {
    console.error("Error exporting data:", err);
    res.status(500).json("Server error");
  }
});

app.delete("/api/url/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.url.delete({
      where: { id: parseInt(id) },
    });

    res.status(200).json({ message: "URL deleted successfully" });
  } catch (err) {
    console.error("Error deleting URL:", err);
    res.status(500).json("Server error");
  }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

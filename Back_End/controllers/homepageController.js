const HomepageContent = require("../models/HomepageContent");
const { safeUpload, safeDelete } = require("../utils/safeUpload");

//Get Homepage Content
exports.getHomepageContent = async (req, res) => {
  try {
    const homepageContent = await HomepageContent.findOne();
    if (!homepageContent) {
      return res.status(404).json({ message: "Homepage content not found" });
    }
    res.status(200).json(homepageContent);
  } catch (error) {
    res.status(500).json({ message: "Error fetching homepage content", error });
  }
};

// Update Homepage Content with File Upload
exports.updateHomepageContent = async (req, res) => {
    try {
  
      if (!req.files || !req.files.backgroundImage) {
        return res.status(400).json({ message: "No file uploaded" });
      }
  
      let imageFile = req.files.backgroundImage;
  
      let backgroundImage;
      try {
        const result = await safeUpload(imageFile);
        backgroundImage = result.relativePath;
      } catch (uploadError) {
        return res.status(400).json({ message: uploadError.message });
      }
  
      const updatedContent = await HomepageContent.findOneAndUpdate(
        {},
        { title: req.body.title, backgroundImage },
        { new: true, upsert: true }
      );
  
      res.status(200).json(updatedContent);
  
    } catch (error) {
      res.status(500).json({ message: "Error updating homepage content", error });
    }
  };
  
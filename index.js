const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.SECRET_KEY_PAYMENT);

const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function run() {
  try {
    await client.connect();

    // Collections
    const usersCollection = client.db("jewelry_shop_db").collection("users");
    const productsCollection = client
      .db("jewelry_shop_db")
      .collection("Products");
    const manageProductsCollection = client
      .db("jewelry_shop_db")
      .collection("manage-Products");
    const cartCollection = client.db("jewelry_shop_db").collection("carts");
    const paymentCollection = client
      .db("jewelry_shop_db")
      .collection("payments");
    const buyCollection = client.db("jewelry_shop_db").collection("buy");

    // JWT verification middleware
    const verifyJWT = (req, res, next) => {
      const authorization = req.headers.authorization;
      if (!authorization) {
        return res
          .status(401)
          .send({ error: true, message: "unauthorized access" });
      }
      // bearer token
      const token = authorization.split(" ")[1];

      jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
          return res
            .status(401)
            .send({ error: true, message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    
    // Admin verification middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden message" });
      }
      next();
    };

    app.get("/", (req, res) => {
      res.send("Running...");
    });

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "1h" });
      res.json({ token });
    });

        // Users related APIs
        app.post("/users", async (req, res) => {
          const user = req.body;
          const query = { email: user.email };
          const existingUser = await usersCollection.findOne(query);
    
          if (existingUser) {
            return res.json({ message: "User already exists" });
          }
    
          const result = await usersCollection.insertOne(user);
          res.json(result);
        });

        app.get("/users", async (req, res) => {
          const result = await usersCollection.find().toArray();
          res.json(result);
        });
    
        app.get("/users/admin/:email", verifyJWT, async (req, res) => {
          const email = req.params.email;
    
          if (req.decoded.email !== email) {
            res.json({ admin: false });
          }
    
          const query = { email: email };
          const user = await usersCollection.findOne(query);
          const result = { admin: user?.role === "admin" };
          res.json(result);
        });
    
        app.get("/users/clint/:email", verifyJWT, async (req, res) => {
          const email = req.params.email;
    
          if (req.decoded.email !== email) {
            res.json({ clint: false });
          }
    
          const query = { email: email };
          const user = await usersCollection.findOne(query);
          const result = { clint: user?.role === "clint" };
          res.json(result);
        });

        
    app.patch("/user/role/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { role } = req.body;

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            role: role,
          },
        };

        const usersCollection = client
          .db("jewelry_shop_db")
          .collection("users");

        const result = await usersCollection.updateOne(filter, updateDoc);

        if (result.modifiedCount === 1) {
          // Role updated successfully
          return res.json({ success: true });
        } else {
          // Failed to update the role
          return res.json({ success: false });
        }
      } catch (error) {
        console.error("Error updating user role in MongoDB:", error);
        return res.status(500).json({ error: "Internal Server Error" });
      }
    });

        // product related APIs
        app.post("/api/products", async (req, res) => {
          try {
            const { title, seats, price, image, clintName, clintEmail } = req.body;
    
            // Parse seats and price as numbers
            const parsedSeats = parseInt(seats);
            const parsedPrice = parseFloat(price);
    
            // Save the new product to MongoDB
            const result = await manageProductsCollection.insertOne({
              title,
              seats: parsedSeats,
              price: parsedPrice,
              image,
              clintEmail,
              clintName,
              status: "pending",
              quantity: 0,
            });
    
            if (result.insertedId) {
              // New product added successfully
              res.json({ success: true });
            } else {
              // Failed to add the product
              res.json({ success: false });
            }
          } catch (error) {
            console.error("Error adding a new product to MongoDB:", error);
            res.status(500).json({ error: "Internal Server Error" });
          }
        });
    
        app.get("/api/all-products", async (req, res) => {
          const result = await productsCollection.find().toArray();
          res.json(result);
        });
    
        app.get("/api/products", verifyJWT, verifyAdmin, async (req, res) => {
          const result = await manageProductsCollection.find().toArray();
          res.json(result);
        });
    
        app.patch("/api/products/:id", async (req, res) => {
          try {
            const id = req.params.id;
            const { status, feedback } = req.body;
    
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {};
    
            if (status) {
              updateDoc.$set = { status };
            }
    
            if (feedback) {
              updateDoc.$set = { feedback };
            }
    
            const result = await manageProductsCollection.updateOne(
              filter,
              updateDoc
            );
    
            if (result.modifiedCount === 1) {
              if (feedback) {
                await productsCollection.updateOne(filter, { $set: { feedback } });
              }
    
              if (status === "approved") {
                const productData = await manageProductsCollection.findOne(filter);
                await productsCollection.insertOne(productData);
              } else if (status === "denied") return res.json({ success: true });
            } else {
              return res.json({ success: false });
            }
          } catch (error) {
            console.error("Error updating product status in MongoDB:", error);
            return res.status(500).json({ error: "Internal Server Error" });
          }
        });
    
        app.delete("/api/Products/:id", async (req, res) => {
          try {
            const id = req.params.id;
    
            const filter = { _id: new ObjectId(id) };
    
            const result = await productsCollection.deleteOne(filter);
    
            if (result.deletedCount === 1) {
              return res.json({ success: true });
            } else {
              return res.json({ success: false });
            }
          } catch (error) {
            console.error("Error deleting product from MongoDB:", error);
            return res.status(500).json({ error: "Internal Server Error" });
          }
        });
    
        app.get("/api/popular-products", async (req, res) => {
          try {
            const popularProducts = await productsCollection
              .find()
              .sort({ quantity: -1 })
              .limit(6)
              .toArray();
    
            res.json(popularProducts);
          } catch (error) {
            console.error(error);
            res.status(500).json({ error: true, message: "An error occurred" });
          }
        });

  } finally {
    // Ensure that the client will close when you finish/error
    // await client.close();
  }
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

run().catch(console.dir);

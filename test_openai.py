from openai import OpenAI
import os
from dotenv import load_dotenv

# load .env
load_dotenv()

# create client
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# test request
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "user", "content": "Say hello in one short sentence"}
    ]
)

print(response.choices[0].message.content)
# CERC Comment Comparator

An AI-powered regulatory comment analysis system that compares stakeholder comments submitted on draft regulations with the final published regulations to determine whether each comment has been Accepted, Partially Accepted, or Rejected.

## Features

- Extracts text from regulatory PDF documents
- Parses stakeholder comments
- Performs semantic retrieval using BM25
- Uses LLMs (Groq/Ollama) for comment classification
- Maps evidence between draft and final regulations
- Generates structured JSON and Excel reports
- Supports multilingual regulatory documents by processing English content

## Project Structure

```
cerc-comment-comparator/
│
├── app/
├── prompts/
├── sample_data/
├── sample_results/
├── main.py
├── requirements.txt
└── README.md
```

## Tech Stack

- Python
- BM25 Retrieval
- Groq API
- Ollama
- PyMuPDF
- pandas
- openpyxl

## Workflow

1. Load Draft Regulation
2. Load Stakeholder Comments
3. Load Final Regulation
4. Parse Comments
5. Retrieve Relevant Context
6. Classify Comments using LLM
7. Generate Reports

## Output

The system generates:

- JSON analysis report
- Excel report
- Acceptance statistics

## Future Improvements

- Web interface
- Advanced semantic retrieval
- Multi-model support
- Docker deployment
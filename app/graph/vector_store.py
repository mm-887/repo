import os
import chromadb
from chromadb.utils import embedding_functions
from app import config

os.makedirs(config.CHROMA_DIR, exist_ok=True)
client = chromadb.PersistentClient(path=config.CHROMA_DIR)

embedding_func = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")

def create_retrieval_text(entity:dict) -> str:
    entity_type = entity.get('type')
    name = entity.get('name', '')
    file_path = entity.get('file', '')
    code = entity.get('code', '')
    if entity_type == 'function_definition':
        return f"File: {file_path}\nFunction: {name}\n{code}"
    elif entity_type == 'class_definition':
        return f"File: {file_path}\nClass: {name}\n{code[:600]}"
    elif entity_type == 'module':
        basename = name.rsplit('\\', 1)[-1].rsplit('/', 1)[-1]
        return f"File: {file_path}\nModule: {basename}\n{code[:2000]}"
    return ""  
    
def chunk_text(text, chunk_size = 1000, overlap = 200):
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += (chunk_size - overlap)
    return chunks

def index_entities(owner, repo_name, entities, batch_size=5000):
    collection_name = f"{owner}.{repo_name}"
    collection = client.get_or_create_collection(
        name=collection_name,
        embedding_function=embedding_func
    )
    existing_ids = collection.get(include=[])["ids"]

    new_ids = []
    documents = []
    metadatas = []
    seen = set()

    def add(doc_id, document, entity):
        if doc_id in seen:
            return
        seen.add(doc_id)
        new_ids.append(doc_id)
        documents.append(document)
        metadatas.append({k: v for k, v in entity.items() if k != 'code'})

    for entity in entities:
        doc_text = create_retrieval_text(entity)
        if not doc_text.strip():
            continue
        if len(doc_text) > 2500:
            chunks = chunk_text(doc_text, chunk_size=2000, overlap=300)
            for i,chunk in enumerate(chunks):
                add(f"{entity['id']}_chunk_{i}", chunk, entity)
        else:
            add(entity['id'], doc_text, entity)

    stale_ids = sorted(set(existing_ids) - seen)

    for start in range(0, len(new_ids), batch_size):
        end = start + batch_size
        collection.upsert(
            ids=new_ids[start:end],
            documents=documents[start:end],
            metadatas=metadatas[start:end]
        )

    for start in range(0, len(stale_ids), batch_size):
        collection.delete(ids=stale_ids[start:start + batch_size])

    return {"documents": len(new_ids), "stale_deleted": len(stale_ids)}

def search(owner, repo_name, query, n_results=5):
    collection_name = f"{owner}.{repo_name}"
    try:
        collection = client.get_collection(
            name=collection_name,
            embedding_function=embedding_func
        )
    except Exception:
        return None
        
    results = collection.query(
        query_texts=[query],
        n_results=n_results
    )
    return results
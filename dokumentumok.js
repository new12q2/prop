// PDF.js configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Document loaded, initializing...');
    
    // Wait for Firebase to be initialized
    while (!window.fbAuth || !window.fbDb) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log('Firebase initialized');

    // Initialize globals
    const { auth, onAuthStateChanged } = window.fbAuth;
    const { db, collection, addDoc, query, where, getDocs, doc, getDoc, updateDoc, deleteDoc, storage } = window.fbDb;
    const documentsRef = collection(db, 'documents');
    
    const pdfState = {
        doc: null,
        pageNum: 1,
        pageRendering: false,
        pageNumPending: null,
        scale: 1.5
    };

    // Get DOM elements
    const elements = {
        uploadBtn: document.querySelector('.upload-btn'),
        modal: document.getElementById('newDocumentModal'),
        closeModal: document.querySelector('.close-modal'),
        cancelBtn: document.getElementById('cancelDocument'),
        documentForm: document.getElementById('newDocumentForm'),
        documentsGrid: document.querySelector('.documents-grid'),
        fileInput: document.getElementById('documentFile'),
        filePreview: document.getElementById('filePreview'),
        editFileInput: document.getElementById('editDocumentFile'),
        editFilePreview: document.getElementById('editFilePreview'),
        pdfViewerModal: document.getElementById('pdfViewerModal'),
        pdfCanvas: document.getElementById('pdfCanvas'),
        prevPageBtn: document.getElementById('prevPage'),
        nextPageBtn: document.getElementById('nextPage'),
        pageNum: document.getElementById('pageNum'),
        pageCount: document.getElementById('pageCount'),
        editModal: document.getElementById('editDocumentModal'),
        editForm: document.getElementById('editDocumentForm'),
        addDocumentBtn: document.querySelector('.upload-btn'),
        newDocumentModal: document.getElementById('newDocumentModal'),
        filterButtons: document.querySelectorAll('.filter-btn')
    };

    // Add authentication state observer
    onAuthStateChanged(auth, async (user) => {
        console.log('Auth state changed:', user ? 'logged in' : 'logged out');
        if (user) {
            // User is signed in, load documents
            await loadDocuments();
        } else {
            // User is signed out, clear documents
            if (elements.documentsGrid) {
                elements.documentsGrid.innerHTML = '<p class="no-documents">A dokumentumok megtekintéséhez jelentkezzen be</p>';
            }
        }
    });

    // File preview functionality
    function updateFilePreview(input, previewElement) {
        if (input.files && input.files[0]) {
            const file = input.files[0];
            if (file.type !== 'application/pdf') {
                alert('Csak PDF fájlok feltöltése engedélyezett');
                input.value = '';
                return;
            }
            if (file.size > 10 * 1024 * 1024) {
                alert('A fájl mérete nem lehet nagyobb 10MB-nál');
                input.value = '';
                return;
            }
            
            previewElement.innerHTML = `
                <i class="fas fa-file-pdf"></i>
                <p>${file.name}</p>
            `;
        } else {
            previewElement.innerHTML = `
                <i class="fas fa-cloud-upload-alt"></i>
                <p>Kattintson vagy húzza ide a PDF fájlt</p>
            `;
        }
    }

    // Add file preview event listeners
    if (elements.fileInput && elements.filePreview) {
        elements.fileInput.addEventListener('change', () => updateFilePreview(elements.fileInput, elements.filePreview));
    }
    if (elements.editFileInput && elements.editFilePreview) {
        elements.editFileInput.addEventListener('change', () => updateFilePreview(elements.editFileInput, elements.editFilePreview));
    }

    // PDF viewer functionality
    async function showPDF(pdfUrl) {
        try {
            if (!elements.pdfViewerModal || !elements.pdfCanvas) {
                console.error('Required PDF viewer elements not found');
                return;
            }

            const ctx = elements.pdfCanvas.getContext('2d');
            
            // Load PDF from URL
            const loadingTask = pdfjsLib.getDocument({
                url: pdfUrl,
                withCredentials: false
            });
            
            pdfState.doc = await loadingTask.promise;
            pdfState.pageNum = 1;

            // PDF rendering function
            async function renderPage(num) {
                if (!pdfState.doc) return;
                
                try {
                    pdfState.pageRendering = true;
                    const page = await pdfState.doc.getPage(num);
                    
                    // Calculate scale to fit width while maintaining aspect ratio
                    const viewport = page.getViewport({ scale: 1.0 });
                    const container = elements.pdfCanvas.parentElement;
                    const scale = (container.clientWidth - 40) / viewport.width;
                    const finalViewport = page.getViewport({ scale });
                    
                    elements.pdfCanvas.height = finalViewport.height;
                    elements.pdfCanvas.width = finalViewport.width;
                    
                    await page.render({
                        canvasContext: ctx,
                        viewport: finalViewport
                    }).promise;
                    
                    pdfState.pageRendering = false;
                    if (pdfState.pageNumPending !== null) {
                        renderPage(pdfState.pageNumPending);
                        pdfState.pageNumPending = null;
                    }
                    
                    elements.pageNum.textContent = num;
                } catch (error) {
                    console.error('Error rendering page:', error);
                    pdfState.pageRendering = false;
                    throw error;
                }
            }

            // Initialize viewer
            await renderPage(1);
            elements.pageCount.textContent = pdfState.doc.numPages;
            elements.pdfViewerModal.style.display = 'block';
            document.body.style.overflow = 'hidden';

            // Navigation handlers
            elements.prevPageBtn.onclick = async () => {
                if (pdfState.pageNum <= 1) return;
                pdfState.pageNum--;
                try {
                    await renderPage(pdfState.pageNum);
                } catch (error) {
                    pdfState.pageNum++;
                    alert('Hiba történt az oldal betöltése közben');
                }
            };

            elements.nextPageBtn.onclick = async () => {
                if (pdfState.pageNum >= pdfState.doc.numPages) return;
                pdfState.pageNum++;
                try {
                    await renderPage(pdfState.pageNum);
                } catch (error) {
                    pdfState.pageNum--;
                    alert('Hiba történt az oldal betöltése közben');
                }
            };

            // Close handler
            const closeViewer = () => {
                elements.pdfViewerModal.style.display = 'none';
                document.body.style.overflow = 'auto';
                ctx.clearRect(0, 0, elements.pdfCanvas.width, elements.pdfCanvas.height);
                if (pdfState.doc) {
                    pdfState.doc.destroy();
                    pdfState.doc = null;
                }
                pdfState.pageNum = 1;
                pdfState.pageRendering = false;
                pdfState.pageNumPending = null;
            };

            elements.pdfViewerModal.querySelector('.close-modal').onclick = closeViewer;
            elements.pdfViewerModal.onclick = (e) => {
                if (e.target === elements.pdfViewerModal) closeViewer();
            };

        } catch (error) {
            console.error('Error showing PDF:', error);
            alert('Hiba történt a PDF megjelenítése közben: ' + error.message);
        }
    }

    // Make showPDF globally available
    window.showPDF = showPDF;

    // Create document card function
    function createDocumentCard(docData) {
        const card = document.createElement('div');
        card.className = 'document-card';
        
        const typeIcon = docData.type === 'contract' ? 'fa-file-contract' :
                        docData.type === 'invoice' ? 'fa-file-invoice' :
                        'fa-file-alt';
        
        const formattedDate = new Date(docData.createdAt).toLocaleDateString('hu-HU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        card.innerHTML = `
            <div class="document-icon">
                <i class="fas ${typeIcon} fa-2x"></i>
            </div>
            <div class="document-info">
                <h3>${docData.title}</h3>
                <p class="document-meta">
                    ${docData.propertyLocation ? `<span><i class="fas fa-home"></i> ${docData.propertyLocation}</span>` : ''}
                    <span><i class="far fa-calendar-alt"></i> ${formattedDate}</span>
                </p>
            </div>
            <div class="document-actions">
                <button class="view-btn" onclick="showPDF('${docData.downloadURL}')" title="Megtekintés">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="edit-btn" onclick="editDocument('${docData.id}')" title="Szerkesztés">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="delete-btn" onclick="deleteDocument('${docData.id}')" title="Törlés">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        
        return card;
    }

    // Document edit function
    async function editDocument(documentId) {
        try {
            const documentRef = doc(db, 'documents', documentId);
            const documentSnap = await getDoc(documentRef);
            
            if (!documentSnap.exists()) {
                alert('A dokumentum nem található');
                return;
            }

            const documentData = documentSnap.data();
            
            // Populate edit form
            const editForm = elements.editForm;
            editForm.querySelector('[name="title"]').value = documentData.title;
            editForm.querySelector('[name="type"]').value = documentData.type;
            if (documentData.propertyId) {
                editForm.querySelector('[name="propertyId"]').value = documentData.propertyId;
            }
            editForm.querySelector('[name="isSigned"]').value = documentData.isSigned;
            
            // Store document ID for update
            editForm.dataset.documentId = documentId;
            
            // Show edit modal
            elements.editModal.style.display = 'block';

            // Add event listeners for closing modal
            const closeModal = () => {
                elements.editModal.style.display = 'none';
                editForm.reset();
            };

            // Close on X button click
            elements.editModal.querySelector('.close-modal').onclick = closeModal;

            // Close on "Mégsem" button click
            elements.editModal.querySelector('.btn-secondary').onclick = closeModal;

            // Close on clicking outside the modal
            elements.editModal.onclick = (e) => {
                if (e.target === elements.editModal) {
                    closeModal();
                }
            };

        } catch (error) {
            console.error('Error loading document for edit:', error);
            alert('Hiba történt a dokumentum betöltése közben');
        }
    }

    // Document delete function
    async function deleteDocument(documentId) {
        if (!confirm('Biztosan törölni szeretné ezt a dokumentumot?')) {
            return;
        }

        try {
            const user = auth.currentUser;
            if (!user) {
                alert('A dokumentum törléséhez be kell jelentkeznie!');
                return;
            }

            const documentRef = doc(db, 'documents', documentId);
            const documentSnap = await getDoc(documentRef);
            
            if (!documentSnap.exists()) {
                alert('A dokumentum nem található');
                return;
            }

            const documentData = documentSnap.data();
            
            // Check ownership
            if (documentData.ownerId !== user.uid) {
                alert('Nincs jogosultsága törölni ezt a dokumentumot');
                return;
            }

            // Delete file from storage if exists
            if (documentData.downloadURL) {
                const storageRef = ref(storage, documentData.downloadURL);
                try {
                    await deleteObject(storageRef);
                } catch (error) {
                    console.error('Error deleting file from storage:', error);
                }
            }

            // Delete document from Firestore
            await deleteDoc(documentRef);
            
            alert('Dokumentum sikeresen törölve!');
            await loadDocuments();
            
        } catch (error) {
            console.error('Error deleting document:', error);
            alert('Hiba történt a dokumentum törlése közben');
        }
    }

    // Make functions globally available
    window.editDocument = editDocument;
    window.deleteDocument = deleteDocument;

    // Document operations
    async function loadDocuments(filterType = 'all') {
        try {
            const user = auth.currentUser;
            if (!user) {
                console.log('No user logged in');
                return;
            }

            console.log('Loading documents for user:', user.uid);
            elements.documentsGrid.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Dokumentumok betöltése...</div>';

            const q = query(documentsRef, where('ownerId', '==', user.uid));
            const querySnapshot = await getDocs(q);
            
            let documents = [];
            querySnapshot.forEach((doc) => {
                documents.push({ ...doc.data(), id: doc.id });
            });

            // Apply filter
            let filteredDocs = documents;
            if (filterType !== 'all') {
                filteredDocs = documents.filter(doc => doc.type === filterType);
            }

            // Update counts
            const counts = {
                all: documents.length,
                contract: documents.filter(doc => doc.type === 'contract').length,
                invoice: documents.filter(doc => doc.type === 'invoice').length,
                other: documents.filter(doc => doc.type === 'other').length
            };

            // Update filter buttons
            elements.filterButtons.forEach(btn => {
                const type = btn.getAttribute('data-filter');
                const label = type === 'all' ? 'Összes' :
                            type === 'contract' ? 'Szerződések' :
                            type === 'invoice' ? 'Számlák' : 'Egyéb';
                btn.textContent = `${label} (${counts[type]})`;
            });

            // Display results
            elements.documentsGrid.innerHTML = '';
            if (filteredDocs.length === 0) {
                elements.documentsGrid.innerHTML = '<p class="no-documents">Nincsenek dokumentumok</p>';
                return;
            }

            // Sort and display documents
            filteredDocs
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .forEach(doc => {
                    elements.documentsGrid.appendChild(createDocumentCard(doc));
                });
        } catch (error) {
            console.error('Error loading documents:', error);
            elements.documentsGrid.innerHTML = '<p class="error">Hiba történt a dokumentumok betöltése közben</p>';
        }
    }

    // Add filter button event listeners
    elements.filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            elements.filterButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            button.classList.add('active');
            // Get filter type and load filtered documents
            const filterType = button.getAttribute('data-filter');
            loadDocuments(filterType);
        });
    });

    // Document form handlers
    elements.documentForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('Form submission started');
        
        const user = auth.currentUser;
        if (!user) {
            alert('A dokumentum feltöltéséhez be kell jelentkeznie!');
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mentés...';

        try {
            const formData = new FormData(e.target);
            const file = elements.fileInput.files[0];
            
            if (!file) {
                alert('Kérem, töltsön fel egy PDF dokumentumot!');
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Mentés';
                return;
            }

            const propertyId = formData.get('propertyId');
            let propertyLocation = '';
            
            if (propertyId) {
                const propertySnap = await getDoc(doc(db, 'properties', propertyId));
                if (propertySnap.exists()) {
                    propertyLocation = propertySnap.data().location;
                }
            }

            // Upload file to Firebase Storage
            const storageRef = ref(storage, `documents/${user.uid}/${Date.now()}_${file.name}`);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);

            const documentData = {
                title: formData.get('title'),
                type: formData.get('type'),
                propertyId,
                propertyLocation,
                ownerId: user.uid,
                createdAt: new Date().toISOString(),
                downloadURL,
                fileName: file.name,
                isSigned: formData.get('isSigned') === 'true'
            };

            await addDoc(documentsRef, documentData);
            
            elements.modal.style.display = 'none';
            e.target.reset();
            elements.filePreview.innerHTML = `
                <i class="fas fa-cloud-upload-alt"></i>
                <p>Kattintson vagy húzza ide a PDF fájlt</p>
            `;
            
            alert('Dokumentum sikeresen feltöltve!');
            await loadDocuments();
            
        } catch (error) {
            console.error('Error uploading document:', error);
            alert('Hiba történt a dokumentum feltöltése közben: ' + error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Mentés';
        }
    });

    // New document modal handlers
    function setupNewDocumentModal() {
        if (!elements.addDocumentBtn || !elements.newDocumentModal) {
            console.error('New document modal elements not found');
            return;
        }

        // Open modal
        elements.addDocumentBtn.addEventListener('click', () => {
            elements.newDocumentModal.style.display = 'block';
            document.body.style.overflow = 'hidden';
        });

        // Close modal functions
        function closeNewDocumentModal() {
            elements.newDocumentModal.style.display = 'none';
            document.body.style.overflow = 'auto';
            if (elements.documentForm) {
                elements.documentForm.reset();
            }
            if (elements.filePreview) {
                elements.filePreview.innerHTML = `
                    <i class="fas fa-cloud-upload-alt"></i>
                    <p>Kattintson vagy húzza ide a PDF fájlt</p>
                `;
            }
        }

        // Close on X button
        const closeButton = elements.newDocumentModal.querySelector('.close-modal');
        if (closeButton) {
            closeButton.addEventListener('click', closeNewDocumentModal);
        }

        // Close on cancel button
        const cancelButton = elements.newDocumentModal.querySelector('.btn-secondary');
        if (cancelButton) {
            cancelButton.addEventListener('click', closeNewDocumentModal);
        }

        // Close on outside click
        elements.newDocumentModal.addEventListener('click', (e) => {
            if (e.target === elements.newDocumentModal) {
                closeNewDocumentModal();
            }
        });
    }

    // Initialize modal handlers
    setupNewDocumentModal();

    // Rest of the code...
    // ...existing code for modal handlers, filter functionality, etc...

});